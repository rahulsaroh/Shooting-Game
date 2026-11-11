import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  GameRegistryEntry,
  PlatformClientMessage,
  PlatformLobbyState,
  PlatformPlayer,
} from '../types.ts';
import { PLAYER_COLORS } from '../../shared/config.ts';
import { triggerPlatformHaptic } from '../shared/haptics.ts';
import { PlatformWakeLock } from '../shared/wakeLock.ts';
import { ControllerApp } from '../../src/controller/ControllerApp.tsx';
import {
  Gamepad2,
  Wifi,
  Play,
  Crown,
  Lock,
  Sparkles,
  Check,
  ArrowLeft,
  Plane,
} from 'lucide-react';

interface PlatformControllerShellProps {
  lobbyState: PlatformLobbyState;
  onSendPlatformMessage: (msg: PlatformClientMessage) => void;
  customGameControllers?: Record<
    string,
    React.ComponentType<{
      player: PlatformPlayer | null;
      onBackToMenu: () => void;
    }>
  >;
}

export const PlatformControllerShell: React.FC<PlatformControllerShellProps> = ({
  lobbyState,
  onSendPlatformMessage,
  customGameControllers = {},
}) => {
  // Share the exact same localStorage keys as DeadAim so joining once works everywhere without re-entering details
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('deadaim_player_name') || ''
  );
  const [selectedColor, setSelectedColor] = useState(
    () => localStorage.getItem('deadaim_player_color') || PLAYER_COLORS[0].hex
  );
  const [reconnectToken, setReconnectToken] = useState(
    () => localStorage.getItem('deadaim_token') || ''
  );
  const [joined, setJoined] = useState<boolean>(() =>
    Boolean(localStorage.getItem('deadaim_token') && localStorage.getItem('deadaim_player_name'))
  );

  const wakeLockRef = useRef<PlatformWakeLock | null>(null);

  useEffect(() => {
    wakeLockRef.current = new PlatformWakeLock();
    return () => {
      wakeLockRef.current?.releaseLock();
    };
  }, []);

  // Keep local state synced when server confirms our player in lobbyState
  const myPlayer: PlatformPlayer | null =
    lobbyState.players.find(
      (p) =>
        (reconnectToken && p.reconnectToken === reconnectToken) ||
        (playerName && p.name.toLowerCase() === playerName.trim().toLowerCase())
    ) || null;

  useEffect(() => {
    if (myPlayer) {
      setJoined(true);
      if (myPlayer.reconnectToken && myPlayer.reconnectToken !== reconnectToken) {
        setReconnectToken(myPlayer.reconnectToken);
        localStorage.setItem('deadaim_token', myPlayer.reconnectToken);
      }
    }
  }, [myPlayer, reconnectToken]);

  const handleJoinLobby = useCallback(() => {
    const finalName = playerName.trim() || `Pilot-${Math.floor(100 + Math.random() * 900)}`;
    setPlayerName(finalName);
    localStorage.setItem('deadaim_player_name', finalName);
    localStorage.setItem('deadaim_player_color', selectedColor);

    wakeLockRef.current?.requestLock().catch(() => {});
    triggerPlatformHaptic('select');

    onSendPlatformMessage({
      gameId: 'platform',
      type: 'platform_join',
      name: finalName,
      color: selectedColor,
      reconnectToken: reconnectToken || undefined,
    });
    setJoined(true);
  }, [playerName, selectedColor, reconnectToken, onSendPlatformMessage]);

  const handleReturnToMenu = useCallback(() => {
    triggerPlatformHaptic('tap');
    onSendPlatformMessage({
      gameId: 'platform',
      type: 'platform_return_menu',
    });
  }, [onSendPlatformMessage]);

  const handleHighlight = (game: GameRegistryEntry) => {
    triggerPlatformHaptic('tap');
    onSendPlatformMessage({
      gameId: 'platform',
      type: 'platform_highlight_game',
      targetGameId: game.id,
    });
  };

  const handleLaunchGame = (game: GameRegistryEntry) => {
    if (game.status === 'coming_soon' || game.valid === false) return;
    triggerPlatformHaptic('launch');
    onSendPlatformMessage({
      gameId: 'platform',
      type: 'platform_select_game',
      targetGameId: game.id,
    });
  };

  // 1. If a game is currently active, switch all phones immediately to that game's controller UI!
  if (lobbyState.activeGameId === 'deadaim') {
    return <ControllerApp onBackToMenu={handleReturnToMenu} />;
  }

  const CustomController = customGameControllers[lobbyState.activeGameId];
  if (CustomController) {
    return <CustomController player={myPlayer} onBackToMenu={handleReturnToMenu} />;
  }

  // Fallback controller if a game without a custom component is selected
  if (lobbyState.activeGameId !== 'menu') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between p-6 select-none font-sans">
        <div className="flex items-center justify-between border-b border-white/15 pb-3">
          <div className="flex items-center gap-2">
            <Plane className="w-5 h-5 text-cyan-400" />
            <span className="font-display font-bold text-base uppercase tracking-wider">
              {lobbyState.activeGameId.toUpperCase()} CONTROLLER
            </span>
          </div>
          <button
            type="button"
            onClick={handleReturnToMenu}
            className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-xs font-display font-bold flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Arcade Menu</span>
          </button>
        </div>
        <div className="my-auto text-center space-y-3">
          <div className="font-display text-2xl font-bold text-cyan-300">
            CONNECTED TO {lobbyState.activeGameId.toUpperCase()}
          </div>
          <p className="text-xs text-slate-300">
            Use the button above to return all players to the Arcade Game Menu at any time.
          </p>
        </div>
        <div />
      </div>
    );
  }

  // 2. Onboarding Join Screen (only shown if phone hasn't joined the platform lobby yet)
  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between p-6 select-none font-sans">
        <div className="max-w-md mx-auto w-full pt-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Gamepad2 className="w-7 h-7 text-cyan-400" />
              <div>
                <h1 className="font-display text-xl font-bold tracking-wider uppercase text-white">
                  NEONDECK ARCADE
                </h1>
                <p className="text-[11px] font-mono text-slate-400">
                  Universal Phone Controller Pairing
                </p>
              </div>
            </div>
            <div className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-xs font-mono flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5" />
              <span>Linked</span>
            </div>
          </div>

          <div className="bg-slate-900/95 border-2 border-cyan-400/50 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div>
              <label className="block text-xs font-display font-bold uppercase tracking-wider text-amber-400 mb-1.5">
                Player Call-Sign
              </label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="e.g. Maverick, Viper, Ace"
                maxLength={16}
                className="w-full bg-slate-950 border border-white/20 focus:border-cyan-400 text-lg font-bold px-4 py-2.5 rounded-xl text-white outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-display font-bold uppercase tracking-wider text-amber-400 mb-1.5">
                Player Color
              </label>
              <div className="grid grid-cols-4 gap-2">
                {PLAYER_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setSelectedColor(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`h-10 rounded-xl transition transform active:scale-95 flex items-center justify-center font-black text-slate-950 text-xs ${
                      selectedColor === c.hex
                        ? 'ring-4 ring-white shadow-md scale-105'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    {selectedColor === c.hex && <Check className="w-4 h-4 stroke-[3]" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-950/90 p-3.5 rounded-xl border border-white/10 text-xs text-slate-300 space-y-1">
              <div className="font-bold text-cyan-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Join Once · Play Any Game</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Your phone stays connected as you switch between <strong>DeadAim Overdrive</strong>{' '}
                (Motion Light-Gun) and <strong>SkyAce Flight Sim</strong> (Tilt Flight Yoke).
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto w-full pb-4 pt-4">
          <button
            type="button"
            onClick={handleJoinLobby}
            className="w-full py-4 rounded-2xl font-display font-bold uppercase text-lg tracking-wider transition transform active:scale-95 shadow-xl flex items-center justify-center gap-2 text-slate-950"
            style={{
              backgroundColor: selectedColor,
              boxShadow: `0 0 25px ${selectedColor}66`,
            }}
          >
            <Gamepad2 className="w-6 h-6" />
            <span>Join Arcade Lobby</span>
          </button>
        </div>
      </div>
    );
  }

  // 3. Joined Phone on 'menu' -> Remote Game Selector UI
  const activeColor = myPlayer?.color || selectedColor;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between p-4 select-none font-sans">
      {/* Top Player Identity Bar */}
      <div className="max-w-md mx-auto w-full space-y-4">
        <div
          className="p-3.5 rounded-2xl bg-slate-900/95 border-2 flex items-center justify-between"
          style={{ borderColor: `${activeColor}88` }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="px-2.5 py-1 rounded-lg font-display font-bold text-xs shrink-0"
              style={{
                backgroundColor: `${activeColor}25`,
                border: `1px solid ${activeColor}`,
                color: activeColor,
              }}
            >
              {myPlayer?.slot || 1}P
            </span>
            <div className="min-w-0">
              <div className="font-display font-bold text-sm text-white truncate">
                {myPlayer?.name || playerName}
              </div>
              <div className="text-[10px] font-mono text-emerald-300 flex items-center gap-1">
                <span>LOBBY READY</span>
                {myPlayer?.isHost && (
                  <span className="text-amber-300 font-bold flex items-center gap-0.5">
                    • <Crown className="w-3 h-3 inline" /> HOST REMOTE
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setJoined(false)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 border border-white/15 text-[11px] font-mono text-slate-300"
          >
            Edit Profile
          </button>
        </div>

        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold tracking-wider uppercase text-white">
            REMOTE GAME LAUNCHER
          </h2>
          <p className="text-xs text-slate-400">
            Tap a cabinet below to highlight it on the TV, then tap <strong>LAUNCH ON TV</strong>:
          </p>
        </div>

        {/* Game Cards List on Phone */}
        <div className="space-y-3">
          {lobbyState.games.map((game) => {
            const isHighlighted = lobbyState.highlightedGameId === game.id;
            const isComingSoon = game.status === 'coming_soon';
            const isInvalid = game.valid === false;

            return (
              <div
                key={game.id}
                onClick={() => handleHighlight(game)}
                className={`p-4 rounded-2xl border-2 transition space-y-3 ${
                  isHighlighted
                    ? 'bg-slate-900 border-cyan-400 shadow-lg'
                    : 'bg-slate-900/60 border-white/15 opacity-85'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display font-bold text-base text-white">{game.title}</div>
                    <div className="text-[11px] font-mono text-cyan-300">{game.controllerType}</div>
                  </div>
                  {isComingSoon ? (
                    <span className="px-2 py-0.5 rounded bg-fuchsia-500/20 border border-fuchsia-400 text-fuchsia-300 font-mono text-[10px] font-bold shrink-0">
                      COMING SOON
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400 text-emerald-300 font-mono text-[10px] font-bold shrink-0">
                      {game.minPlayers}–{game.maxPlayers}P
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-snug">{game.description}</p>

                {!isComingSoon && !isInvalid ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLaunchGame(game);
                    }}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-amber-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 active:scale-95 transition"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>LAUNCH ON TV</span>
                  </button>
                ) : (
                  <div className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 font-display font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>{isComingSoon ? 'COMING SOON' : 'UNAVAILABLE'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-md mx-auto w-full pt-4 pb-2 text-center text-[11px] font-mono text-slate-400">
        Your phone controller will automatically switch when a game starts.
      </div>
    </div>
  );
};
