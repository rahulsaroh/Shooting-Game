/**
 * Standalone Bot Client Simulator
 * Simulates 6 physical smartphone motion-aim gun controllers over WebSocket.
 * Run with: npm run sim
 */

import { WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '../shared/types.ts';
import { PLAYER_COLORS } from '../shared/config.ts';

const SERVER_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const BOT_COUNT = 6;

interface SimulatedPhone {
  id: string;
  name: string;
  color: string;
  ws: WebSocket;
  phaseAngle: number;
  ammo: number;
  isReloading: boolean;
  score: number;
  kills: number;
}

const bots: SimulatedPhone[] = [];

console.log('🤖 Starting DeadAim 6-Phone Controller Simulator...');
console.log(`📡 Target Server: ${SERVER_URL}`);

for (let i = 0; i < BOT_COUNT; i++) {
  const color = PLAYER_COLORS[i % PLAYER_COLORS.length].hex;
  const name = `Phone-Gun-0${i + 1}`;
  const ws = new WebSocket(SERVER_URL);

  const bot: SimulatedPhone = {
    id: `sim_${i}`,
    name,
    color,
    ws,
    phaseAngle: (i * Math.PI) / 3,
    ammo: 12,
    isReloading: false,
    score: 0,
    kills: 0,
  };

  bots.push(bot);

  ws.on('open', () => {
    // Send join message
    const joinMsg: ClientMessage = {
      type: 'phone_join',
      name: bot.name,
      color: bot.color,
      reconnectToken: `token_sim_${i}`,
    };
    ws.send(JSON.stringify(joinMsg));
    console.log(`✅ [${bot.name}] Connected and Joined (Color: ${bot.color})`);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === 'phone_joined') {
        bot.id = msg.player.id;
      } else if (msg.type === 'haptic') {
        if (msg.pattern === 'reload') {
          bot.isReloading = true;
          setTimeout(() => {
            bot.isReloading = false;
            bot.ammo = 12;
          }, 1400);
        }
      } else if (msg.type === 'hit_event' && msg.playerId === bot.id) {
        bot.score += msg.headshot ? 50 : 20;
        if (msg.killed) bot.kills++;
      }
    } catch {
      // ignore
    }
  });

  ws.on('error', (err) => {
    console.warn(`⚠️ [${bot.name}] WS Error:`, err.message);
  });
}

// 60Hz Motion Aim Stream Loop
let frameCount = 0;
const aimInterval = setInterval(() => {
  frameCount++;
  const t = Date.now() * 0.002;

  for (const bot of bots) {
    if (bot.ws.readyState === WebSocket.OPEN) {
      // Simulate figure-8 and elliptical gyro movement across zombie heights
      const x = 0.5 + Math.sin(t + bot.phaseAngle) * 0.32;
      const y = 0.48 + Math.cos((t + bot.phaseAngle) * 1.5) * 0.15;

      const pitch = (y - 0.48) * 26;
      const yaw = (x - 0.5) * 36;

      const aimMsg: ClientMessage = {
        type: 'aim',
        x: Math.max(0.02, Math.min(0.98, x)),
        y: Math.max(0.02, Math.min(0.98, y)),
        pitch,
        yaw,
      };

      bot.ws.send(JSON.stringify(aimMsg));

      // Periodic random shooting (approx 2 shots per second per bot)
      if (frameCount % 30 === 0 && Math.random() < 0.8 && !bot.isReloading) {
        if (bot.ammo > 0) {
          bot.ammo--;
          bot.ws.send(JSON.stringify({ type: 'shoot', timestamp: Date.now() } as ClientMessage));
        } else {
          bot.isReloading = true;
          bot.ws.send(JSON.stringify({ type: 'reload' } as ClientMessage));
        }
      }
    }
  }
}, 1000 / 60);

// Status Logger every 5 seconds
setInterval(() => {
  console.log('--- [SIMULATOR STATUS] ---');
  bots.forEach((b) => {
    console.log(
      `🎯 ${b.name}: ReadyState=${b.ws.readyState === WebSocket.OPEN ? 'ACTIVE' : 'OFFLINE'} | Ammo=${b.ammo}/12 | Score=${b.score} | Kills=${b.kills}`
    );
  });
}, 5000);

process.on('SIGINT', () => {
  clearInterval(aimInterval);
  bots.forEach((b) => b.ws.close());
  console.log('\nSimulator stopped.');
  process.exit(0);
});
