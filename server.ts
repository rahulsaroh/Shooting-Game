import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { GameEngine } from './server/GameEngine.ts';
import { ClientMessage, ServerMessage, ServerNetworkInfo } from './shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_URL = process.env.APP_URL;

// Helper to find the best local IPv4 address
function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      // Skip over internal (i.e. 127.0.0.1) and non-ipv4
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();

// In cloud/AI studio environments, APP_URL takes precedence for public phone access
const baseUrl = APP_URL ? APP_URL.replace(/\/$/, '') : `http://${localIp}:${PORT}`;
const isHttps = baseUrl.startsWith('https://');

const networkInfo: ServerNetworkInfo = {
  localIp,
  port: PORT,
  localUrl: baseUrl,
  controllerUrl: `${baseUrl}/controller`,
  gameUrl: `${baseUrl}/game`,
  isHttps,
};

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  try {
    const pathname = new URL(
      request.url || '/',
      `http://${request.headers.host || 'localhost'}`
    ).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  } catch (err) {
    console.error('WebSocket upgrade error:', err);
  }
});

// Track client sockets
const clients = new Map<WebSocket, { playerId?: string; type: 'tv' | 'phone' }>();
const playerSockets = new Map<string, WebSocket>();

// Initialize Game Engine
const gameEngine = new GameEngine(
  (msg: ServerMessage) => {
    // Broadcast to all connected clients
    const payload = JSON.stringify(msg);
    for (const [ws] of clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch {
          // ignore send errors on closing sockets
        }
      }
    }
  },
  (playerId: string, msg: ServerMessage) => {
    // Send direct message to a specific player
    const ws = playerSockets.get(playerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // ignore send errors on closing sockets
      }
    }
  }
);

// Start 30Hz game tick loop
setInterval(() => {
  gameEngine.tick();
}, 1000 / 30);

// API Routes
app.get('/api/info', async (_req, res) => {
  try {
    const qrDataUrl = await QRCode.toDataURL(networkInfo.controllerUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#00f5d4',
        light: '#0a0d14',
      },
    });

    res.json({
      ...networkInfo,
      qrDataUrl,
      playerCount: gameEngine.getPlayers().length,
      phase: gameEngine.getPhase(),
      settings: gameEngine.getSettings(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/state', (_req, res) => {
  res.json({
    world: gameEngine.getWorldState(),
  });
});

app.post('/api/action', (req, res) => {
  try {
    const msg = req.body as ClientMessage;
    switch (msg?.type) {
      case 'start_game':
        gameEngine.startGame();
        break;
      case 'restart_game':
        gameEngine.restartGame();
        break;
      case 'update_settings':
        gameEngine.updateSettings(msg.settings);
        break;
      case 'spawn_bots':
        gameEngine.spawnBots(msg.count);
        break;
      case 'remove_bots':
        gameEngine.removeBots();
        break;
    }
    res.json({ ok: true, world: gameEngine.getWorldState() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Direct link redirects
app.get('/controller', (_req, res, next) => {
  // Pass to frontend router
  next();
});

app.get('/game', (_req, res, next) => {
  // Pass to frontend router
  next();
});

// WebSocket Connection Management
wss.on('connection', (ws: WebSocket) => {
  clients.set(ws, { type: 'tv' });

  // Send current lobby state immediately on connect
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'lobby_update',
        players: gameEngine.getPlayers(),
        settings: gameEngine.getSettings(),
        phase: gameEngine.getPhase(),
      } as ServerMessage)
    );
  }

  ws.on('message', (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;

      switch (msg.type) {
        case 'phone_join': {
          const clientMeta = clients.get(ws);
          if (clientMeta) clientMeta.type = 'phone';

          const { player, token } = gameEngine.handleJoin(
            msg.name,
            msg.color,
            msg.reconnectToken
          );

          if (clientMeta) clientMeta.playerId = player.id;
          playerSockets.set(player.id, ws);

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'phone_joined',
                player,
                reconnectToken: token,
              } as ServerMessage)
            );
          }
          break;
        }

        case 'aim': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleAim(meta.playerId, msg.x, msg.y, msg.pitch, msg.yaw, msg.roll);
          }
          break;
        }

        case 'shoot': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleShoot(meta.playerId);
          }
          break;
        }

        case 'reload': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleReload(meta.playerId);
          }
          break;
        }

        case 'recenter': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleRecenter(meta.playerId);
          }
          break;
        }

        case 'update_player_options': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleUpdatePlayerOptions(meta.playerId, {
              autoFire: msg.autoFire,
              autoReload: msg.autoReload,
              unlimitedAmmo: msg.unlimitedAmmo,
            });
          }
          break;
        }

        case 'switch_weapon': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleSwitchWeapon(meta.playerId, msg.weapon);
          }
          break;
        }

        case 'submit_highscore': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.submitHighScore(meta.playerId, msg.initials);
          }
          break;
        }

        case 'unlock_reward': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleUnlockReward(meta.playerId, msg.rewardId);
          }
          break;
        }

        case 'equip_reward': {
          const meta = clients.get(ws);
          if (meta?.playerId) {
            gameEngine.handleEquipReward(meta.playerId, msg.rewardId);
          }
          break;
        }

        case 'skip_tutorial': {
          gameEngine.skipTutorial();
          break;
        }

        case 'start_game': {
          gameEngine.startGame();
          break;
        }

        case 'restart_game': {
          gameEngine.restartGame();
          break;
        }

        case 'update_settings': {
          gameEngine.updateSettings(msg.settings);
          break;
        }

        case 'spawn_bots': {
          gameEngine.spawnBots(msg.count);
          break;
        }

        case 'remove_bots': {
          gameEngine.removeBots();
          break;
        }

        case 'ping': {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', time: msg.time }));
          }
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    if (meta?.playerId) {
      gameEngine.handleDisconnect(meta.playerId);
      playerSockets.delete(meta.playerId);
    }
    clients.delete(ws);
  });
});

// Vite Middleware integration in Dev / Production serving
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    process.env.DISABLE_HMR = 'true';

    // Serve a WebSocket-free @vite/client shim so HMR disabled environments never throw WebSocket transport errors
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    accept() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
    data: {}
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return \`\${pathname}?\${queryToInject}\${search ? '&' + search.slice(1) : ''}\${hash || ''}\`;
}
export class ErrorOverlay {}
`);
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static build in production
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n======================================================');
    console.log('🧟 DEADAIM: MOTION-AIM ZOMBIE SHOOTER SERVER ONLINE 🧟');
    console.log('======================================================');
    console.log(`🖥️  PC / TV Game Screen:   ${networkInfo.gameUrl}`);
    console.log(`📱 Phone Gun Controller:  ${networkInfo.controllerUrl}`);
    console.log(`🌐 Local Wi-Fi Network IP: ${networkInfo.localIp}:${networkInfo.port}`);
    console.log(`🔒 HTTPS Status:          ${isHttps ? 'Enabled (Secure)' : 'HTTP (Local/Dev)'}`);
    console.log('======================================================\n');
  });
}

startServer();
