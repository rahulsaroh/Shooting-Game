import React, { useState, useEffect } from 'react';
import {
  PlayerInfo,
  GameSettings,
  ServerNetworkInfo,
  HighScoreEntry,
} from '../../shared/types.ts';
import { STAGES } from '../../shared/config.ts';
import {
  Play,
  Settings,
  Bot,
  Smartphone,
  Wifi,
  Volume2,
  CheckCircle2,
  Trophy,
  Tv,
  Sparkles,
} from 'lucide-react';

interface LobbyViewProps {
  players: PlayerInfo[];
  settings: GameSettings;
  networkInfo: ServerNetworkInfo | null;
  highScores?: HighScoreEntry[];
  audioUnlocked?: boolean;
  onUnlockAudio?: () => void;
  onStartGame: () => void;
  onOpenSettings: () => void;
  onSpawnBots: (count: number) => void;
  onRemoveBots: () => void;
  onBackToMenu?: () => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  players,
  settings,
  networkInfo,
  highScores = [],
  audioUnlocked = false,
  onUnlockAudio,
  onStartGame,
  onOpenSettings,
  onSpawnBots,
  onRemoveBots,
  onBackToMenu,
}) => {
  const qrUrl = networkInfo?.controllerUrl || `${window.location.origin}/controller`;
  // Only show connected players/hosts (never show default empty placeholder slots)
  const connectedPlayers = players.filter((p) => p.isConnected);
  const botCount = connectedPlayers.filter((p) => p.isBot).length;

  // Phase B: Attract Mode after 30 seconds idle in Lobby (or manual toggle)
  const [attractMode, setAttractMode] = useState(false);
  const [demoSlideIndex, setDemoSlideIndex] = useState(0);

  useEffect(() => {
    let idleTimer: number;
    const resetIdle = () => {
      setAttractMode(false);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        setAttractMode(true);
      }, 30000);
    };

    resetIdle();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetIdle));
    return () => {
      window.clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, resetIdle));
    };
  }, []);

  useEffect(() => {
    if (!attractMode) return;
    const interval = window.setInterval(() => {
      setDemoSlideIndex((prev) => (prev + 1) % (STAGES.length + 1));
    }, 5500);
    return () => window.clearInterval(interval);
  }, [attractMode]);

  // Attract Mode Overlay (30s idle showcase: Demo Scenes + Flashing "FIRE TO JOIN" + High-Score Table)
  if (attractMode) {
    const activeStage = STAGES[demoSlideIndex % STAGES.length];
    const showHighScoresSlide = demoSlideIndex === STAGES.length;

    return (
      <div
        onClick={() => setAttractMode(false)}
        className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-transparent to-slate-950/85 flex flex-col justify-between p-8 lg:p-12 z-30 select-none cursor-pointer"
      >
        {/* Top Attract Mode Marquee */}
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full pl-24">
          <div className="px-4 py-1.5 rounded-xl bg-fuchsia-500/30 border-2 border-fuchsia-400 text-fuchsia-200 font-display font-bold text-sm tracking-widest uppercase">
            ARCADE ATTRACT DEMO MODE
          </div>
          <div className="font-mono text-sm font-extrabold text-amber-300 tracking-widest animate-pulse">
            FREE PLAY · CLICK OR SCAN PHONE QR TO JOIN
          </div>
        </div>

        {/* Center Demo Stage Showcase OR High-Score Table */}
        <div className="my-auto max-w-5xl mx-auto w-full text-center space-y-6">
          {showHighScoresSlide ? (
            <div className="bg-slate-950/65 backdrop-blur-md border-2 border-amber-400/80 rounded-3xl p-8 shadow-2xl space-y-5">
              <div className="flex items-center justify-center gap-3 text-amber-300 font-display text-3xl font-bold tracking-wider">
                <Trophy className="w-8 h-8" />
                <span>HALL OF FAME · HIGH SCORES</span>
                <Trophy className="w-8 h-8" />
              </div>
              <div className="grid grid-cols-1 gap-2 max-w-2xl mx-auto font-mono">
                {highScores.slice(0, 6).map((entry, idx) => (
                  <div
                    key={`${entry.initials}_${idx}`}
                    className="flex items-center justify-between px-5 py-2.5 rounded-xl bg-white/5 border border-white/15 text-lg"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-amber-400 font-extrabold w-8">#{idx + 1}</span>
                      <span className="px-2.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-400 text-cyan-300 font-bold tracking-widest">
                        {entry.initials}
                      </span>
                      <span className="text-white font-bold">{entry.name}</span>
                    </div>
                    <div className="flex items-center gap-6">
                      <span className="text-xs text-slate-300">STAGE {entry.stage}</span>
                      <span className="text-amber-300 font-extrabold tabular-nums">
                        {String(entry.score).padStart(6, '0')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-slate-950/45 backdrop-blur-md border-2 border-cyan-400/70 rounded-3xl p-8 max-w-3xl mx-auto space-y-3">
              <div className="text-xs font-mono font-bold tracking-widest text-amber-300 uppercase">
                STAGE PREVIEW {activeStage.id} OF {STAGES.length}
              </div>
              <h2 className="font-display text-5xl font-bold italic text-white tracking-wider">
                {activeStage.name}
              </h2>
              <p className="text-cyan-300 font-mono text-sm uppercase tracking-widest">
                SECTOR: {activeStage.subtitle} · BOSS: {activeStage.bossName}
              </p>
            </div>
          )}

          {/* Giant Flashing "FIRE TO JOIN" Callout (Readable from 3m TV distance) */}
          <div className="pt-2">
            <div className="inline-block px-10 py-4 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 text-slate-950 font-display font-bold text-3xl tracking-widest animate-bounce shadow-xl">
              🔥 FIRE TO JOIN · PRESS START 🔥
            </div>
          </div>
        </div>

        {/* Bottom Instructions */}
        <div className="text-center font-mono text-sm text-white/80">
          Click anywhere or aim with your phone controller to return to the Arcade Lobby
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-gradient-to-b from-slate-950/65 via-slate-950/20 to-slate-950/75 flex flex-col justify-between p-6 lg:p-10 z-30 select-none overflow-y-auto">
      {/* Top Arcade Cabinet Marquee Header */}
      <header className="flex items-center justify-between gap-6 border-b border-white/15 pb-4 max-w-7xl mx-auto w-full pl-24">
        <div className="font-display text-2xl font-bold tracking-wider text-white whitespace-nowrap shrink-0 flex items-center gap-2">
          <span>DEADAIM ARCADE</span>
          {settings.mode === 'kids' && (
            <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/30 border border-emerald-400 text-emerald-200 text-xs font-mono">
              KIDS PARTY MODE
            </span>
          )}
        </div>

        <div className="hidden xl:flex items-center gap-3 text-sm font-medium text-slate-200">
          <span className="text-amber-300 font-semibold whitespace-nowrap">3 STAGES + BOSSES</span>
          <span aria-hidden="true" className="text-white/30">·</span>
          <span className="capitalize whitespace-nowrap">{settings.theme} Theme</span>
          <span aria-hidden="true" className="text-white/30">·</span>
          <span className="capitalize whitespace-nowrap">{settings.difficulty} Difficulty</span>
          <span aria-hidden="true" className="text-white/30">·</span>
          <span className="whitespace-nowrap">Drop-In Co-Op</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {!audioUnlocked ? (
            <button
              type="button"
              onClick={onUnlockAudio}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-display font-bold tracking-wider flex items-center gap-2 transition animate-pulse cursor-pointer whitespace-nowrap shrink-0 shadow-md"
            >
              <Volume2 className="w-4 h-4" />
              <span>CLICK TO START AUDIO</span>
            </button>
          ) : (
            <div className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-400/50 rounded-xl text-xs font-mono font-bold text-emerald-300 flex items-center gap-1.5 whitespace-nowrap">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>3D AUDIO ACTIVE</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setAttractMode(true)}
            className="px-3 py-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/35 backdrop-blur-md border border-fuchsia-400/50 rounded-xl text-xs font-semibold text-fuchsia-200 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            title="Preview 30s Idle Attract Mode & High Scores"
          >
            <Tv className="w-4 h-4" />
            <span className="hidden sm:inline">Attract Demo</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/25 rounded-xl text-xs font-semibold text-white flex items-center gap-2 transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Settings className="w-4 h-4 text-cyan-300" />
            <span>Game Options</span>
          </button>

          {onBackToMenu && (
            <button
              type="button"
              onClick={onBackToMenu}
              className="px-3.5 py-2 bg-slate-900/90 hover:bg-slate-800 border border-cyan-400/50 rounded-xl text-xs font-display font-bold text-cyan-300 flex items-center gap-1.5 transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
              title="Return to Multi-Game Arcade Menu (or hold Esc)"
            >
              <span>◀ ARCADE MENU</span>
            </button>
          )}
        </div>
      </header>

      {/* Center Attract Showcase & Glass Pairing Deck */}
      <div className="my-auto py-3 max-w-7xl mx-auto w-full space-y-5">
        {/* Bespoke SVG Arcade Cabinet Title Lockup */}
        <div className="text-center flex flex-col items-center">
          <svg
            viewBox="0 0 680 115"
            className="w-full max-w-xl h-auto"
            role="img"
            aria-label="DeadAim Timezone Arcade Light-Gun Shooter"
          >
            <defs>
              <linearGradient id="arcadeTitleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00f5d4" />
                <stop offset="50%" stopColor="#ffbe0b" />
                <stop offset="100%" stopColor="#f72585" />
              </linearGradient>
              <linearGradient id="arcadeSubGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f72585" />
                <stop offset="100%" stopColor="#7209b7" />
              </linearGradient>
            </defs>
            <polygon
              points="35,12 645,12 665,58 645,104 35,104 15,58"
              fill="#0f172a"
              fillOpacity="0.55"
              stroke="url(#arcadeTitleGrad)"
              strokeWidth="3.5"
            />
            <circle cx="82" cy="58" r="28" fill="none" stroke="#00f5d4" strokeWidth="3" />
            <circle cx="82" cy="58" r="12" fill="none" stroke="#ffbe0b" strokeWidth="2.5" />
            <line x1="46" y1="58" x2="118" y2="58" stroke="#f72585" strokeWidth="3" />
            <line x1="82" y1="22" x2="82" y2="94" stroke="#f72585" strokeWidth="3" />
            <text
              x="365"
              y="64"
              textAnchor="middle"
              fill="url(#arcadeTitleGrad)"
              fontFamily="Chakra Petch, sans-serif"
              fontWeight="700"
              fontStyle="italic"
              fontSize="54"
              letterSpacing="4"
            >
              DEADAIM OVERDRIVE
            </text>
            <rect x="190" y="75" width="350" height="22" rx="6" fill="url(#arcadeSubGrad)" />
            <text
              x="365"
              y="90"
              textAnchor="middle"
              fill="#ffffff"
              fontFamily="Plus Jakarta Sans, sans-serif"
              fontWeight="800"
              fontSize="12"
              letterSpacing="3"
            >
              MOTION LIGHT-GUN ARCADE SHOOTER
            </text>
          </svg>
        </div>

        {/* Three-Column Glass Split: QR Gun Pairing | Connected Players | Arcade High Scores */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left Column: Scan Phone QR to Join as Light-Gun */}
          <div className="lg:col-span-4 bg-slate-950/38 backdrop-blur-md border border-white/20 rounded-2xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-white tracking-wide">
                  PHONE LIGHT-GUN PAIRING
                </h2>
                <p className="text-xs text-slate-200">
                  Scan QR code with your phone camera (Drop-in anytime!)
                </p>
              </div>
              <Smartphone className="w-6 h-6 text-cyan-300 shrink-0" />
            </div>

            <div className="my-4 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-4">
              <div className="p-2 bg-slate-950/70 border border-amber-400/70 rounded-2xl shrink-0">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                    qrUrl
                  )}&color=00f5d4&bgcolor=090d16`}
                  alt="Scan to open phone gun controller"
                  referrerPolicy="no-referrer"
                  className="w-28 h-28 rounded-xl block"
                />
              </div>

              <div className="space-y-1.5 text-left flex-1 min-w-0">
                <div className="text-xs font-semibold text-amber-300">
                  1. Connect phone to same Wi-Fi
                </div>
                <div className="text-xs text-slate-200">
                  2. Scan QR or open on mobile:
                </div>
                <div className="bg-black/40 border border-white/15 px-2.5 py-1.5 rounded-xl font-mono text-[11px] font-bold text-cyan-300 break-all select-all">
                  {qrUrl}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-medium">
                  <Wifi className="w-3.5 h-3.5 shrink-0" />
                  <span>4 Weapons · Shake to Reload</span>
                </div>
              </div>
            </div>

            {/* Optional Bot Wingman Controls */}
            <div className="pt-3 border-t border-white/15 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-200">
                <Bot className="w-4 h-4 text-amber-300 shrink-0" />
                <span>Co-Op Wingman Bots:</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSpawnBots(1)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-xs font-bold text-white transition cursor-pointer whitespace-nowrap"
                >
                  +1 Bot
                </button>
                {botCount > 0 && (
                  <button
                    type="button"
                    onClick={onRemoveBots}
                    className="px-2.5 py-1.5 bg-rose-500/25 hover:bg-rose-500/40 border border-rose-400/50 rounded-lg text-xs font-bold text-rose-200 transition cursor-pointer whitespace-nowrap"
                  >
                    Clear ({botCount})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Center Column: Connected Players Only (Translucent Glass Cards) */}
          <div className="lg:col-span-5 bg-slate-950/38 backdrop-blur-md border border-white/20 rounded-2xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-white tracking-wide">
                  CONNECTED LIGHT-GUNS ({connectedPlayers.length})
                </h2>
                <p className="text-xs text-slate-200">
                  Players can join or leave mid-game without restarting
                </p>
              </div>
              <span className="font-mono text-xs font-extrabold text-amber-300 tabular-nums animate-pulse">
                FIRE TO JOIN
              </span>
            </div>

            {connectedPlayers.length === 0 ? (
              <div className="my-5 py-6 px-4 rounded-2xl border border-dashed border-white/20 bg-white/5 text-center space-y-1.5">
                <div className="font-display font-bold text-base text-white tracking-wide">
                  WAITING FOR PHONE CONTROLLER TO CONNECT...
                </div>
                <div className="text-xs text-slate-300">
                  Scan the QR code on the left with your phone, or click{' '}
                  <strong>START ARCADE STAGE</strong> to play immediately!
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 my-3 max-h-48 overflow-y-auto">
                {connectedPlayers.map((player) => (
                  <div
                    key={player.id}
                    className="rounded-xl p-2.5 bg-white/5 backdrop-blur-md border flex items-center justify-between gap-2.5"
                    style={{
                      borderColor: `${player.color}88`,
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="font-display font-bold text-sm px-2 py-0.5 rounded-md shrink-0"
                        style={{
                          backgroundColor: `${player.color}22`,
                          border: `1px solid ${player.color}`,
                          color: player.color,
                        }}
                      >
                        {player.slot}P
                      </span>
                      <div className="min-w-0">
                        <div className="font-display font-bold text-sm text-white truncate">
                          {player.name}
                        </div>
                        <div className="text-[10px] text-emerald-300 font-mono flex items-center gap-1">
                          <span>{player.isBot ? 'AI Wingman' : 'Phone Ready'}</span>
                          {!player.isBot && (
                            <span className="text-amber-300">· 🎟️ {player.tickets}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-white/15 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                <span>Includes Interactive Tutorial + 3 Boss Stages</span>
              </div>

              <button
                type="button"
                onClick={onStartGame}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 hover:from-amber-300 hover:to-pink-400 text-slate-950 font-display font-bold text-lg tracking-wider flex items-center justify-center gap-2 transition transform active:scale-95 cursor-pointer whitespace-nowrap"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>START ARCADE STAGE</span>
              </button>
            </div>
          </div>

          {/* Right Column: Persistent Arcade High-Score Leaderboard */}
          <div className="lg:col-span-3 bg-slate-950/38 backdrop-blur-md border border-white/20 rounded-2xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-amber-300 tracking-wide flex items-center gap-1.5">
                  <Trophy className="w-4 h-4" />
                  <span>HIGH SCORES</span>
                </h2>
                <p className="text-xs text-slate-300">Top Arcade Light-Gunners</p>
              </div>
            </div>

            <div className="my-3 space-y-1.5 font-mono text-xs">
              {highScores.slice(0, 5).map((hs, i) => (
                <div
                  key={`${hs.initials}_${i}`}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-amber-400 font-bold">#{i + 1}</span>
                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 font-bold">
                      {hs.initials}
                    </span>
                    <span className="text-white truncate">{hs.name}</span>
                  </div>
                  <span className="text-amber-300 font-extrabold tabular-nums shrink-0">
                    {String(hs.score).padStart(6, '0')}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-white/15 text-[11px] font-mono text-slate-300 text-center">
              Enter 3-letter initials on phone after match!
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Single-Line Control Hint */}
      <footer className="max-w-7xl mx-auto w-full text-center text-xs text-slate-300 flex flex-wrap items-center justify-center gap-4">
        <span>Hold Phone Flat = Center Aim · Tilt Left/Right/Up/Down · Auto-Fire on Zombies</span>
        <span className="text-white/40">|</span>
        <span className="font-mono text-[11px] text-cyan-300">
          [F3] Perf &amp; Tick Overlay · [Key H] Hitboxes · [Key K] Preview Audio · [Key M] Mute
        </span>
      </footer>
    </div>
  );
};
