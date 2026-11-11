import React, { useEffect, useRef, useState } from 'react';
import { GameRegistryEntry, PlatformLobbyState } from '../types.ts';
import { ServerNetworkInfo } from '../../shared/types.ts';
import { PlatformAudioSynthesizer } from '../shared/audio.ts';
import {
  Gamepad2,
  Play,
  Smartphone,
  Users,
  Wifi,
  Sparkles,
  Lock,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  Crown,
  AlertTriangle,
} from 'lucide-react';

interface LauncherMenuProps {
  lobbyState: PlatformLobbyState;
  networkInfo: ServerNetworkInfo | null;
  onHighlightGame: (gameId: string) => void;
  onSelectGame: (gameId: string) => void;
}

export const LauncherMenu: React.FC<LauncherMenuProps> = ({
  lobbyState,
  networkInfo,
  onHighlightGame,
  onSelectGame,
}) => {
  const audioRef = useRef<PlatformAudioSynthesizer | null>(null);
  const [muted, setMuted] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  useEffect(() => {
    audioRef.current = new PlatformAudioSynthesizer();
  }, []);

  const games = lobbyState.games;
  const highlightedId =
    lobbyState.highlightedGameId || (games.length > 0 ? games[0].id : 'deadaim');
  const connectedPlayers = lobbyState.players.filter((p) => p.isConnected);
  const qrUrl = networkInfo?.controllerUrl || `${window.location.origin}/controller`;

  const triggerHighlight = (gameId: string) => {
    if (gameId !== highlightedId) {
      audioRef.current?.playMenuHighlight();
      onHighlightGame(gameId);
    }
  };

  const triggerLaunch = (game: GameRegistryEntry) => {
    if (game.status === 'coming_soon') {
      setBannerError(`"${game.title}" is Coming Soon!`);
      window.setTimeout(() => setBannerError(null), 2200);
      return;
    }
    if (game.valid === false) {
      setBannerError(game.validationError || `"${game.title}" folder is missing or invalid.`);
      window.setTimeout(() => setBannerError(null), 2500);
      return;
    }
    audioRef.current?.playMenuLaunch();
    onSelectGame(game.id);
  };

  // Keyboard navigation on TV: Left/Right arrows + Enter/Space
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (games.length === 0) return;

      const currentIndex = Math.max(
        0,
        games.findIndex((g) => g.id === highlightedId)
      );

      if (e.key === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        const next = games[(currentIndex + 1) % games.length];
        if (next) triggerHighlight(next.id);
      } else if (e.key === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        const prev = games[(currentIndex - 1 + games.length) % games.length];
        if (prev) triggerHighlight(prev.id);
      } else if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        const selected = games[currentIndex];
        if (selected) triggerLaunch(selected);
      } else if (e.code === 'KeyM') {
        const nextMuted = !muted;
        setMuted(nextMuted);
        audioRef.current?.setMuted(nextMuted);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="relative w-screen h-screen overflow-y-auto bg-slate-950 text-white select-none font-sans flex flex-col justify-between p-6 lg:p-10">
      {/* Subtle Ambient Arcade Grid Backdrop */}
      <div
        className="pointer-events-none fixed inset-0 opacity-25"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 15%, rgba(6, 182, 212, 0.28), transparent 60%), radial-gradient(circle at 85% 80%, rgba(249, 115, 22, 0.2), transparent 55%)',
        }}
      />

      {/* Top Arcade Platform Header */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/15 pb-4 max-w-7xl mx-auto w-full pl-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 shadow-lg">
            <Gamepad2 className="w-6 h-6" />
          </div>
          <div>
            <div className="font-display text-2xl font-bold tracking-wider uppercase text-white flex items-center gap-2.5">
              <span>NEONDECK MULTI-GAME ARCADE</span>
              <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 font-mono text-xs">
                {games.filter((g) => g.status === 'available').length} ACTIVE CABINETS
              </span>
            </div>
            <p className="text-xs text-slate-300 font-mono">
              One Phone Pairing · Instant Controller Switching · Zero Reconnects
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/5 border border-white/15 text-xs font-mono text-slate-200">
            <ChevronLeft className="w-4 h-4 text-cyan-400" />
            <ChevronRight className="w-4 h-4 text-cyan-400" />
            <span>ARROWS / PHONE REMOTE TO SELECT · ENTER TO LAUNCH</span>
          </div>

          <button
            type="button"
            onClick={() => {
              const nextMuted = !muted;
              setMuted(nextMuted);
              audioRef.current?.setMuted(nextMuted);
            }}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-xs font-mono font-bold text-slate-200 flex items-center gap-1.5 cursor-pointer transition"
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{muted ? 'MUTED' : 'AUDIO ON'}</span>
          </button>
        </div>
      </header>

      {/* Optional Toast Banner for Coming Soon / Validation Feedback */}
      {bannerError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-display font-bold text-sm tracking-wider shadow-2xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{bannerError}</span>
        </div>
      )}

      {/* Main Content: Big Arcade Game Cards Grid */}
      <main className="relative z-10 my-auto py-4 max-w-7xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-wider uppercase text-white">
              SELECT YOUR ARCADE CABINET
            </h1>
            <p className="text-sm text-slate-300">
              Click a cabinet card, press <strong className="text-amber-300">Enter</strong>, or tap{' '}
              <strong className="text-cyan-300">Launch</strong> on any connected phone controller
            </p>
          </div>
          <div className="font-mono text-xs text-amber-300 font-bold tracking-widest uppercase hidden sm:block">
            FREE PLAY · CREDITS ∞
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {games.map((game, idx) => {
            const isHighlighted = game.id === highlightedId;
            const isComingSoon = game.status === 'coming_soon';
            const isInvalid = game.valid === false;

            return (
              <div
                key={game.id}
                onMouseEnter={() => triggerHighlight(game.id)}
                onClick={() => {
                  triggerHighlight(game.id);
                  triggerLaunch(game);
                }}
                className={`group relative rounded-3xl overflow-hidden border-2 transition-all duration-200 flex flex-col justify-between cursor-pointer ${
                  isHighlighted
                    ? 'bg-slate-900/95 border-cyan-400 shadow-[0_0_35px_rgba(34,211,238,0.28)] -translate-y-1.5'
                    : 'bg-slate-900/65 border-white/15 hover:border-white/35 opacity-85 hover:opacity-100'
                }`}
              >
                {/* Card Thumbnail with Fallback */}
                <div className="relative h-48 w-full overflow-hidden bg-slate-950">
                  <img
                    src={game.thumbnail}
                    alt={game.title}
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = 'none';
                    }}
                    className={`w-full h-full object-cover transition-transform duration-500 ${
                      isHighlighted ? 'scale-105' : 'group-hover:scale-105'
                    } ${isComingSoon || isInvalid ? 'grayscale opacity-55' : ''}`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />

                  {/* Cabinet Number & Status Badge */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-950/85 border border-white/20 font-mono text-xs font-bold text-cyan-300">
                      CABINET #{idx + 1}
                    </span>

                    {isComingSoon ? (
                      <span className="px-3 py-1 rounded-lg bg-fuchsia-500/90 text-white font-display font-bold text-xs tracking-wider uppercase flex items-center gap-1 shadow-md">
                        <Lock className="w-3.5 h-3.5" />
                        <span>COMING SOON</span>
                      </span>
                    ) : isInvalid ? (
                      <span className="px-3 py-1 rounded-lg bg-rose-500/90 text-white font-display font-bold text-xs tracking-wider uppercase flex items-center gap-1 shadow-md">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>UNAVAILABLE</span>
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-lg bg-emerald-500/90 text-slate-950 font-display font-bold text-xs tracking-wider uppercase flex items-center gap-1 shadow-md">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>READY TO PLAY</span>
                      </span>
                    )}
                  </div>

                  {/* Player Count & Controller Type Strip */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                    <div className="px-2.5 py-1 rounded-lg bg-slate-950/85 border border-white/15 text-xs font-mono text-amber-300 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      <span>
                        {game.minPlayers}–{game.maxPlayers} PLAYERS
                      </span>
                    </div>
                    <div className="px-2.5 py-1 rounded-lg bg-slate-950/85 border border-white/15 text-[11px] font-mono text-slate-200 truncate">
                      {game.controllerType}
                    </div>
                  </div>
                </div>

                {/* Card Copy & Action Button */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-1.5">
                    <h2 className="font-display text-2xl font-bold tracking-wide text-white flex items-center justify-between">
                      <span>{game.title}</span>
                    </h2>
                    <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                      {game.description}
                    </p>
                  </div>

                  <div className="pt-2">
                    {isComingSoon ? (
                      <div className="w-full py-3 rounded-xl bg-white/5 border border-white/15 text-slate-400 font-display font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2">
                        <Lock className="w-4 h-4" />
                        <span>IN DEVELOPMENT · COMING SOON</span>
                      </div>
                    ) : isInvalid ? (
                      <div className="w-full py-3 rounded-xl bg-rose-950/50 border border-rose-400/40 text-rose-300 font-display font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span>FOLDER MISSING</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerLaunch(game);
                        }}
                        className={`w-full py-3 rounded-xl font-display font-bold text-base tracking-wider uppercase flex items-center justify-center gap-2 transition cursor-pointer ${
                          isHighlighted
                            ? 'bg-gradient-to-r from-cyan-400 via-sky-400 to-amber-400 text-slate-950 shadow-lg'
                            : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                        }`}
                      >
                        <Play className="w-5 h-5 fill-current" />
                        <span>LAUNCH {game.title.split(':')[0].toUpperCase()}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Persistent Phone Lobby & QR Pairing Bar */}
        <div className="bg-slate-900/80 backdrop-blur-md border border-white/20 rounded-3xl p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          {/* QR Code & URL */}
          <div className="lg:col-span-5 flex items-center gap-4 border-b lg:border-b-0 lg:border-r border-white/15 pb-4 lg:pb-0 lg:pr-4">
            <div className="p-2 bg-slate-950 border border-cyan-400/60 rounded-2xl shrink-0">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                  qrUrl
                )}&color=00f5d4&bgcolor=090d16`}
                alt="Scan QR to join Phone Arcade Controller"
                referrerPolicy="no-referrer"
                className="w-20 h-20 rounded-xl block"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="font-display font-bold text-sm text-cyan-300 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 shrink-0" />
                <span>JOIN ONCE WITH YOUR PHONE</span>
              </div>
              <p className="text-xs text-slate-300">
                Scan QR or open URL below. Your phone automatically transforms into each game&apos;s
                custom controller!
              </p>
              <div className="px-2.5 py-1 rounded-lg bg-slate-950 border border-white/15 font-mono text-xs font-bold text-amber-300 truncate select-all">
                {qrUrl}
              </div>
            </div>
          </div>

          {/* Connected Lobby Players */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="font-display font-bold text-sm text-white tracking-wide flex items-center gap-2">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span>CONNECTED ARCADE CONTROLLERS ({connectedPlayers.length} / 8)</span>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Host phone can browse &amp; launch games remotely
              </span>
            </div>

            {connectedPlayers.length === 0 ? (
              <div className="py-3 px-4 rounded-2xl bg-slate-950/60 border border-dashed border-white/20 text-xs text-slate-300 flex items-center justify-between">
                <span>
                  Waiting for phones to scan QR code... (Or click any game card above to play on PC!)
                </span>
                <span className="font-mono text-amber-300 font-bold animate-pulse">READY</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {connectedPlayers.map((player) => (
                  <div
                    key={player.id}
                    className="px-3 py-2 rounded-xl bg-slate-950/90 border flex items-center gap-2.5"
                    style={{ borderColor: `${player.color}88` }}
                  >
                    <span
                      className="px-2 py-0.5 rounded font-display font-bold text-xs"
                      style={{
                        backgroundColor: `${player.color}25`,
                        border: `1px solid ${player.color}`,
                        color: player.color,
                      }}
                    >
                      {player.slot}P
                    </span>
                    <span className="font-display font-bold text-sm text-white">{player.name}</span>
                    {player.isHost && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-400/20 border border-amber-400 text-amber-300 font-mono text-[10px] font-bold flex items-center gap-1">
                        <Crown className="w-3 h-3" />
                        HOST
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="relative z-10 max-w-7xl mx-auto w-full text-center text-xs text-slate-400 font-mono flex flex-wrap items-center justify-center gap-4">
        <span>[← / →] Highlight Game</span>
        <span>•</span>
        <span>[Enter / Space] Launch Game</span>
        <span>•</span>
        <span>[Long-Press Esc or Options Modal] Return to Arcade Menu from any Game</span>
      </footer>
    </div>
  );
};
