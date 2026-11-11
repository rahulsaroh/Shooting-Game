import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameApp } from './game/GameApp.tsx';
import { LauncherMenu } from '../platform/client/LauncherMenu.tsx';
import { PlatformControllerShell } from '../platform/client/PlatformControllerShell.tsx';
import {
  PlatformClientMessage,
  PlatformLobbyState,
  PlatformServerMessage,
} from '../platform/types.ts';
import { ServerNetworkInfo } from '../shared/types.ts';
import gamesRegistry from '../platform/games.json' with { type: 'json' };
import { Tv, Smartphone, Gamepad2, Plane, ArrowLeft } from 'lucide-react';

export default function App() {
  const [route, setRoute] = useState<'game' | 'controller' | 'choose'>(() => {
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');

    if (roleParam === 'controller' || path.startsWith('/controller')) {
      return 'controller';
    }
    if (roleParam === 'game' || path.startsWith('/game')) {
      return 'game';
    }

    // Check if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    if (isMobile) {
      return 'controller';
    }

    return 'game';
  });

  const [networkInfo, setNetworkInfo] = useState<ServerNetworkInfo | null>(null);
  const [lobbyState, setLobbyState] = useState<PlatformLobbyState>(() => {
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const initialGame =
      params.get('game') || (path.startsWith('/deadaim') ? 'deadaim' : 'menu');
    return {
      activeGameId: initialGame,
      highlightedGameId: 'deadaim',
      games: gamesRegistry as any,
      players: [],
    };
  });

  const [f2DebugVisible, setF2DebugVisible] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const sendPlatformMessage = useCallback((msg: PlatformClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(msg));
        return;
      } catch {
        // fallback to REST below
      }
    }
    fetch('/api/platform/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.state) setLobbyState(data.state);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/info')
      .then((res) => res.json())
      .then((data: ServerNetworkInfo) => setNetworkInfo(data))
      .catch(() => {});

    fetch('/api/platform')
      .then((res) => res.json())
      .then((data) => {
        if (data?.state) {
          const path = window.location.pathname.toLowerCase();
          const params = new URLSearchParams(window.location.search);
          if (params.get('game') === 'deadaim' || path.startsWith('/deadaim')) {
            setLobbyState({ ...data.state, activeGameId: 'deadaim' });
          } else {
            setLobbyState(data.state);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Connect Platform WebSocket listener
  useEffect(() => {
    let closed = false;
    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as PlatformServerMessage;
          if (msg?.gameId === 'platform') {
            if (msg.type === 'platform_state' || msg.type === 'platform_joined') {
              setLobbyState(msg.state);
            }
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!closed) {
          setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  // Listen to popstate for browser back/forward and F2 debug toggle
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path.startsWith('/controller')) {
        setRoute('controller');
      } else if (path.startsWith('/game')) {
        setRoute('game');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'F2' || e.key === 'F2') {
        setF2DebugVisible((prev) => !prev);
      }
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const switchRole = (newRole: 'game' | 'controller') => {
    setRoute(newRole);
    window.history.pushState({}, '', newRole === 'game' ? '/game' : '/controller');
  };

  const handleHighlightGame = useCallback(
    (targetGameId: string) => {
      setLobbyState((prev) => ({ ...prev, highlightedGameId: targetGameId }));
      sendPlatformMessage({
        gameId: 'platform',
        type: 'platform_highlight_game',
        targetGameId,
      });
    },
    [sendPlatformMessage]
  );

  const handleSelectGame = useCallback(
    (targetGameId: string) => {
      setLobbyState((prev) => ({ ...prev, activeGameId: targetGameId }));
      sendPlatformMessage({
        gameId: 'platform',
        type: 'platform_select_game',
        targetGameId,
      });
    },
    [sendPlatformMessage]
  );

  const handleReturnToMenu = useCallback(() => {
    setLobbyState((prev) => ({ ...prev, activeGameId: 'menu' }));
    sendPlatformMessage({
      gameId: 'platform',
      type: 'platform_return_menu',
    });
  }, [sendPlatformMessage]);

  const renderTvContent = () => {
    if (lobbyState.activeGameId === 'menu') {
      return (
        <LauncherMenu
          lobbyState={lobbyState}
          networkInfo={networkInfo}
          onHighlightGame={handleHighlightGame}
          onSelectGame={handleSelectGame}
        />
      );
    }

    if (lobbyState.activeGameId === 'deadaim') {
      return <GameApp onBackToMenu={handleReturnToMenu} />;
    }

    // Fallback preview screen for other games prior to Phase 3 mount
    return (
      <div className="w-screen h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 select-none font-sans space-y-6">
        <Plane className="w-16 h-16 text-cyan-400 animate-pulse" />
        <h1 className="font-display text-4xl font-bold tracking-wider uppercase text-white">
          SKYACE: HORIZON SQUADRON
        </h1>
        <p className="text-slate-300 text-sm max-w-md text-center">
          3D Flight Simulator cabinet initialized. Press the button below or hold Escape to return to
          the Arcade Launcher Menu.
        </p>
        <button
          type="button"
          onClick={handleReturnToMenu}
          className="px-6 py-3 rounded-2xl bg-cyan-400 text-slate-950 font-display font-bold text-base tracking-wider uppercase flex items-center gap-2 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Return to Arcade Menu</span>
        </button>
      </div>
    );
  };

  return (
    <div className="w-full h-full min-h-screen bg-black text-white relative">
      {route === 'controller' ? (
        <PlatformControllerShell
          lobbyState={lobbyState}
          onSendPlatformMessage={sendPlatformMessage}
        />
      ) : (
        renderTvContent()
      )}

      {/* Phase 3: Floating Role Switcher Pill is hidden by default and only visible when Debug Mode [F2] is active */}
      {f2DebugVisible && (
        <div className="fixed top-2 left-2 z-50 flex items-center gap-1 bg-neutral-900/95 border border-amber-400/60 p-1 rounded-xl text-[11px] font-mono shadow-lg">
          <span className="px-1.5 text-amber-300 font-bold">[F2]</span>
          <button
            type="button"
            onClick={() => switchRole('game')}
            className={`px-2 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer ${
              route === 'game'
                ? 'bg-cyan-500 text-black font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Tv className="w-3 h-3" />
            <span>TV</span>
          </button>
          <button
            type="button"
            onClick={() => switchRole('controller')}
            className={`px-2 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer ${
              route === 'controller'
                ? 'bg-cyan-500 text-black font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3 h-3" />
            <span>Phone</span>
          </button>
          {lobbyState.activeGameId !== 'menu' && (
            <button
              type="button"
              onClick={handleReturnToMenu}
              className="px-2 py-1 rounded-lg flex items-center gap-1 text-amber-300 hover:text-white transition cursor-pointer"
            >
              <Gamepad2 className="w-3 h-3" />
              <span>Menu</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
