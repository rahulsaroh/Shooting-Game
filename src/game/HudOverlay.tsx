import React, { useState, useEffect, useRef } from 'react';
import { GameSettings, GameWorldState } from '../../shared/types.ts';
import {
  Volume2,
  VolumeX,
  Music,
  Shield,
  Snowflake,
  Flame,
  RotateCcw,
  Infinity as InfinityIcon,
  RefreshCw,
  Crosshair,
  HeartPulse,
  FastForward,
  AlertTriangle,
  Menu,
  Sliders,
  Skull,
} from 'lucide-react';
import { STAGES, WEAPONS, ZOMBIE_VISUAL_SCALE } from '../../shared/config.ts';
import { getTurretScreenX } from './ThreeScene.ts';
import {
  ArcadeHitPopup,
  QueuedBannerNotification,
  TurretToast,
  formatStreakBadge,
} from './uiNotificationQueue.ts';

export type { ArcadeHitPopup };

interface HudOverlayProps {
  world: GameWorldState;
  soundEnabled: boolean;
  musicEnabled: boolean;
  f2DebugMode?: boolean;
  bossWarningFlash?: boolean;
  activeBanner?: QueuedBannerNotification | null;
  turretToasts?: TurretToast[];
  onToggleSound: () => void;
  onToggleMusic: () => void;
  onOpenSettings?: () => void;
  onReturnLobby?: () => void;
  onSkipTutorial?: () => void;
  onUpdateSettings?: (settings: Partial<GameSettings>) => void;
  lastHitPlayerId?: string | null;
  hitPopups?: ArcadeHitPopup[];
}

// Helper to project 3D world coordinates to normalized 2D screen coordinates for HUD callouts
export function projectToScreen(x: number, y: number, z: number, aspect = 16 / 9) {
  const dx = x;
  const dy = y - 2.4;
  const dz = z - 5.0;
  const zCam = dy * -0.052103 + dz * -0.998642;
  const yCam = dy * 0.998642 + dz * -0.052103;
  const xCam = dx;
  if (zCam <= 0.2) return { x: 0.5, y: 0.5 };
  const focalY = 0.940363;
  const focalX = focalY / aspect;
  return {
    x: Math.max(0.06, Math.min(0.94, 0.5 + (xCam / zCam) * focalX)),
    y: Math.max(0.12, Math.min(0.86, 0.5 - (yCam / zCam) * focalY)),
  };
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  world,
  soundEnabled,
  musicEnabled,
  f2DebugMode = false,
  bossWarningFlash = false,
  activeBanner = null,
  turretToasts = [],
  onToggleSound,
  onToggleMusic,
  onOpenSettings,
  onReturnLobby,
  onSkipTutorial,
  onUpdateSettings,
  lastHitPlayerId,
  hitPopups = [],
}) => {
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);

  // Phase 4: Short fading crosshair trail per player (stores up to 4 recent positions)
  const trailHistoryRef = useRef<Record<string, { x: number; y: number }[]>>({});

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setQuickMenuOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const barricadePct = Math.max(
    0,
    Math.min(100, (world.barricadeHp / world.maxBarricadeHp) * 100)
  );
  const isDanger = barricadePct < 30;
  const totalSegments = 16;
  const filledSegments = Math.ceil((barricadePct / 100) * totalSegments);

  // Only show actively connected players/hosts (1 to 8 players, sorted by slot)
  const connectedPlayers = world.players
    .filter((p) => p.isConnected)
    .sort((a, b) => a.slot - b.slot)
    .slice(0, 8);
  const downedPlayers = connectedPlayers.filter((p) => p.isDowned);

  // Update short fading trail history for each connected player
  for (const p of connectedPlayers) {
    const hist = trailHistoryRef.current[p.id] || [];
    const last = hist[hist.length - 1];
    if (!last || Math.hypot(p.crosshair.x - last.x, p.crosshair.y - last.y) > 0.008) {
      trailHistoryRef.current[p.id] = [...hist.slice(-3), { x: p.crosshair.x, y: p.crosshair.y }];
    }
  }

  // Zombies currently at point-blank range scratching the screen
  const scratchingZombies = world.zombies.filter((z) => z.state === 'attacking');
  const isBeingScratched = scratchingZombies.length > 0;

  // Civilians and Bosses
  const activeCivilians = world.zombies.filter((z) => z.isCivilian && z.state !== 'dying');
  const activeBosses = world.zombies.filter((z) => z.type === 'boss' && z.state !== 'dying');
  const primaryBoss = activeBosses[0] || null;
  const stageDef = STAGES[world.stageIndex ?? 0] || STAGES[0];

  // Determine single active upper-third banner (Central Notification Queue takes priority, followed by single-line phase banner)
  const effectiveBanner: {
    text: string;
    tone: 'amber' | 'cyan' | 'emerald' | 'rose' | 'fuchsia';
  } | null = activeBanner
    ? { text: activeBanner.text, tone: activeBanner.tone }
    : (world.slowMoRemainingMs || 0) > 0
    ? { text: '⚡ BOSS ELIMINATED · SLOW-MOTION FINISH! ⚡', tone: 'fuchsia' }
    : world.phase === 'COUNTDOWN'
    ? {
        text: `${world.stageName} · WAVE 0${world.currentWave} STARTS IN ${world.countdownSeconds}s`,
        tone: 'amber',
      }
    : world.phase === 'WAVE_CLEARED'
    ? {
        text: `WAVE 0${world.currentWave} CLEARED · NEXT WAVE IN ${world.intermissionCountdown}s`,
        tone: 'emerald',
      }
    : world.phase === 'BONUS_ROUND'
    ? {
        text: `🎯 BONUS GALLERY ROUND (${world.intermissionCountdown}s) · SHOOT DRONES & CRATES!`,
        tone: 'fuchsia',
      }
    : null;

  const bannerToneClasses: Record<string, string> = {
    amber: 'bg-slate-950/88 border-amber-400 text-amber-300',
    cyan: 'bg-slate-950/88 border-cyan-400 text-cyan-200',
    emerald: 'bg-slate-950/88 border-emerald-400 text-emerald-300',
    rose: 'bg-rose-950/90 border-rose-400 text-rose-200',
    fuchsia: 'bg-fuchsia-950/90 border-amber-300 text-amber-200',
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between px-[3.2vw] py-[2.4vh] select-none overflow-hidden font-sans">
      {/* Phase 6: Boss Entrance Perimeter Warning Border (No glowing screen wash) */}
      {bossWarningFlash && (
        <div
          className="absolute inset-0 pointer-events-none z-15 animate-pulse border-4 border-amber-400/80"
        />
      )}

      {/* Full-Screen Zombie Claw Scratch Overlay when zombies reach point-blank range */}
      {isBeingScratched && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          {scratchingZombies.map((z, idx) => {
            const normX = Math.max(0.18, Math.min(0.82, 0.5 + z.x * 0.14));
            return (
              <div
                key={z.id}
                className="absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 opacity-65"
                style={{
                  left: `${normX * 100}%`,
                }}
              >
                <svg viewBox="0 0 240 240" className="w-full h-full">
                  <g
                    stroke={idx % 2 === 0 ? '#ff0055' : '#ffbe0b'}
                    strokeLinecap="round"
                    fill="none"
                  >
                    <path d="M 35 25 Q 115 110 205 210" strokeWidth="6" />
                    <path d="M 70 20 Q 140 105 220 195" strokeWidth="7" />
                    <path d="M 18 55 Q 100 135 185 225" strokeWidth="5" />
                    <path d="M 105 18 Q 165 95 230 168" strokeWidth="4" />
                  </g>
                  <g stroke="#ffffff" strokeLinecap="round" fill="none" opacity="0.65">
                    <path d="M 35 25 Q 115 110 205 210" strokeWidth="1.5" />
                    <path d="M 70 20 Q 140 105 220 195" strokeWidth="2" />
                    <path d="M 18 55 Q 100 135 185 225" strokeWidth="1.5" />
                  </g>
                </svg>
              </div>
            );
          })}
        </div>
      )}

      {/* =====================================================================
          PHASE 3 & 6 TOP HUD BAR:
          Only Stage & Wave, Barricade/Forcefield Health, and Boss Health Bar (when present).
          Large TV-legible typography (28px+ for key values) with high contrast.
         ===================================================================== */}
      <div className="relative z-30 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          {/* 1. Top-Left: Stage Name & Wave (28px+ TV-legible) */}
          <div className="bg-slate-950/75 backdrop-blur-md border-2 border-white/25 px-5 py-2 rounded-2xl flex items-center gap-4 shadow-xl">
            <div>
              <div className="text-xs font-display font-bold tracking-widest text-cyan-300 uppercase leading-tight">
                {world.stageName || `STAGE ${(world.stageIndex ?? 0) + 1}`}
              </div>
              <div className="font-display text-[1.75rem] font-extrabold tracking-wider text-white tabular-nums leading-none mt-0.5">
                WAVE 0{world.currentWave}
                <span className="text-white/60 text-base font-mono ml-1">
                  /0{world.settings.maxWaves}
                </span>
              </div>
            </div>

            {(world.effects.freezeRemainingMs > 0 ||
              world.effects.doubleDamageRemainingMs > 0) && (
              <div className="flex items-center gap-2 border-l border-white/20 pl-3">
                {world.effects.freezeRemainingMs > 0 && (
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/25 border border-cyan-400 text-cyan-200 text-sm font-mono font-bold tabular-nums">
                    <Snowflake className="w-4 h-4" />
                    <span>{(world.effects.freezeRemainingMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
                {world.effects.doubleDamageRemainingMs > 0 && (
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-fuchsia-500/25 border border-fuchsia-400 text-amber-200 text-sm font-mono font-bold tabular-nums">
                    <Flame className="w-4 h-4" />
                    <span>2X {(world.effects.doubleDamageRemainingMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Top-Center: Barricade / Forcefield Health Bar (28px+ HP digits, 4K scalable via rem) */}
          <div className="w-full max-w-md bg-slate-950/75 backdrop-blur-md border-2 border-white/25 px-5 py-2 rounded-2xl shadow-xl">
            <div className="flex items-center justify-between font-display font-bold mb-1">
              <span className="flex items-center gap-2 text-sm text-amber-300 tracking-wider">
                <Shield className={`w-5 h-5 ${isDanger ? 'text-rose-400' : 'text-cyan-300'}`} />
                {isBeingScratched ? '⚠️ BREACH ALERT!' : 'FORCEFIELD HP'}
              </span>
              <span
                className={`font-mono font-extrabold text-[1.65rem] leading-none tabular-nums ${
                  isDanger ? 'text-rose-400' : 'text-emerald-300'
                }`}
              >
                {world.barricadeHp}
                <span className="text-white/55 text-base">/{world.maxBarricadeHp}</span>
              </span>
            </div>

            <div className="grid grid-cols-16 gap-1 bg-black/50 p-1 rounded-lg border border-white/15">
              {Array.from({ length: totalSegments }).map((_, idx) => {
                const active = idx < filledSegments;
                let cellColor = 'bg-white/10';
                if (active) {
                  if (isDanger) cellColor = 'bg-rose-500';
                  else if (idx < 6) cellColor = 'bg-emerald-400';
                  else if (idx < 12) cellColor = 'bg-cyan-400';
                  else cellColor = 'bg-amber-400';
                }
                return <div key={idx} className={`h-3 rounded-xs transition-all ${cellColor}`} />;
              })}
            </div>
          </div>

          {/* 3. Top-Right: Discrete Menu Button (Sound/Music/Lobby moved inside menu opened by [Tab]) */}
          <div className="relative pointer-events-auto">
            <button
              type="button"
              onClick={() => setQuickMenuOpen((prev) => !prev)}
              className="p-2.5 rounded-2xl bg-slate-950/65 hover:bg-slate-900/90 backdrop-blur-md border border-white/25 text-white/80 hover:text-white flex items-center gap-1.5 transition cursor-pointer shadow-lg"
              title="Open Quick Menu [Tab]"
            >
              <Menu className="w-5 h-5 text-cyan-300" />
              <span className="text-xs font-mono text-white/60 hidden sm:inline">[TAB]</span>
            </button>

            {quickMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-slate-950/95 backdrop-blur-xl border-2 border-cyan-400/60 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-1.5 z-50">
                <div className="text-[11px] font-mono font-bold text-cyan-300 px-2 py-0.5 border-b border-white/10">
                  CABINET MENU [TAB]
                </div>
                <button
                  type="button"
                  onClick={onToggleSound}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-left text-xs font-display font-bold text-white flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-cyan-300" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-rose-400" />
                    )}
                    SFX Audio
                  </span>
                  <span className={soundEnabled ? 'text-emerald-300' : 'text-rose-400'}>
                    {soundEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onToggleMusic}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-left text-xs font-display font-bold text-white flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-fuchsia-300" />
                    Music Layer
                  </span>
                  <span className={musicEnabled ? 'text-emerald-300' : 'text-rose-400'}>
                    {musicEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>

                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      onOpenSettings();
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-left text-xs font-display font-bold text-white flex items-center gap-2 cursor-pointer"
                  >
                    <Sliders className="w-4 h-4 text-amber-300" />
                    <span>Cabinet Settings</span>
                  </button>
                )}

                {onReturnLobby && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuickMenuOpen(false);
                      onReturnLobby();
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/50 text-left text-xs font-display font-bold text-rose-200 flex items-center gap-2 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4 text-amber-300" />
                    <span>Return to Lobby</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Phase 6: Dedicated Boss Health Bar with Phase Markers at 33% and 66% HP */}
        {primaryBoss && (
          <div className="w-full max-w-2xl mx-auto bg-slate-950/85 backdrop-blur-md border-2 border-fuchsia-400/80 px-5 py-2 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between text-xs font-display font-bold mb-1">
              <span className="flex items-center gap-2 text-fuchsia-300 tracking-widest uppercase text-sm">
                <Skull className="w-4 h-4 text-amber-300" />
                BOSS: {stageDef.bossName}
              </span>
              <span className="font-mono font-extrabold text-lg text-amber-300 tabular-nums">
                {Math.max(0, Math.round(primaryBoss.hp))} / {primaryBoss.maxHp} HP
              </span>
            </div>
            <div className="relative w-full h-4 bg-black/70 rounded-lg overflow-hidden border border-white/20">
              <div
                className="h-full bg-gradient-to-r from-rose-600 via-fuchsia-500 to-amber-400 transition-all duration-150"
                style={{
                  width: `${Math.max(0, Math.min(100, (primaryBoss.hp / primaryBoss.maxHp) * 100))}%`,
                }}
              />
              {/* Phase 6: Boss Phase Markers at 33% and 66% HP */}
              <div
                className="absolute top-0 bottom-0 left-1/3 w-0.5 bg-white/80 z-10"
                title="Phase 3 Threshold (33%)"
              />
              <div
                className="absolute top-0 bottom-0 left-2/3 w-0.5 bg-white/80 z-10"
                title="Phase 2 Threshold (66%)"
              />
            </div>
          </div>
        )}

        {/* Phase 3: Debug Assist Toggles (Hidden by default; shown ONLY when Debug Mode [F2] is active!) */}
        {f2DebugMode && onUpdateSettings && (
          <div className="mx-auto bg-slate-950/85 backdrop-blur-md border border-amber-400/70 px-3 py-1.5 rounded-xl flex items-center gap-2 pointer-events-auto shadow-lg">
            <span className="text-[11px] font-mono font-bold text-amber-300">[F2 DEBUG]</span>
            <button
              type="button"
              onClick={() => onUpdateSettings({ autoFire: !world.settings.autoFire })}
              className={`px-2.5 py-1 rounded-lg text-xs font-display font-bold tracking-wider flex items-center gap-1 transition cursor-pointer ${
                world.settings.autoFire
                  ? 'bg-emerald-500/30 border border-emerald-400 text-emerald-200'
                  : 'bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>AUTO-FIRE: {world.settings.autoFire ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateSettings({ autoReload: !world.settings.autoReload })}
              className={`px-2.5 py-1 rounded-lg text-xs font-display font-bold tracking-wider flex items-center gap-1 transition cursor-pointer ${
                world.settings.autoReload
                  ? 'bg-cyan-500/30 border border-cyan-400 text-cyan-200'
                  : 'bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>AUTO-RELOAD: {world.settings.autoReload ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateSettings({ unlimitedAmmo: !world.settings.unlimitedAmmo })}
              className={`px-2.5 py-1 rounded-lg text-xs font-display font-bold tracking-wider flex items-center gap-1 transition cursor-pointer ${
                world.settings.unlimitedAmmo
                  ? 'bg-amber-500/30 border border-amber-400 text-amber-200'
                  : 'bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              <InfinityIcon className="w-3.5 h-3.5" />
              <span>UNLIMITED: {world.settings.unlimitedAmmo ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        )}
      </div>

      {/* =====================================================================
          PHASE 2 CENTRAL NOTIFICATION QUEUE BANNER (UPPER THIRD OF SCREEN):
          Only ONE single-line banner shown at a time; never overlaps Forcefield HP bar or center action!
         ===================================================================== */}
      {effectiveBanner && world.phase !== 'TUTORIAL' && (
        <div className="fixed top-[16.5%] left-1/2 transform -translate-x-1/2 z-35 pointer-events-none max-w-[92vw]">
          <div
            className={`px-6 py-2 rounded-2xl backdrop-blur-md border-2 font-display font-extrabold text-[1.5rem] tracking-wider whitespace-nowrap shadow-xl ${
              bannerToneClasses[effectiveBanner.tone] || bannerToneClasses.amber
            }`}
          >
            {effectiveBanner.text}
          </div>
        </div>
      )}

      {/* Phase D: Short Interactive Tutorial Banner before Wave 1 (Upper-Third Positioned) */}
      {world.phase === 'TUTORIAL' && (
        <div className="fixed top-[16%] left-1/2 transform -translate-x-1/2 text-center z-35 pointer-events-auto">
          <div className="inline-block bg-slate-950/85 backdrop-blur-md border-2 border-cyan-400 px-7 py-3.5 rounded-2xl space-y-1.5 shadow-2xl">
            <div className="font-display text-xs font-bold tracking-widest text-amber-300 whitespace-nowrap">
              LIGHT-GUN CALIBRATION ({world.countdownSeconds}s) · HOLD PHONE FLAT FOR CENTER
            </div>
            <div className="font-display text-2xl font-extrabold italic text-white tracking-wider whitespace-nowrap">
              TILT TO AIM · TAP TRIGGER TO SHOOT · AVOID BLUE CIVILIANS!
            </div>
            {onSkipTutorial && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={onSkipTutorial}
                  className="px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-xs tracking-wider inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <FastForward className="w-3.5 h-3.5" />
                  <span>SKIP TUTORIAL &amp; START WAVE 1</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Civilian "DON'T SHOOT!" On-Screen Callout Badges */}
      {activeCivilians.map((civ) => {
        const pos = projectToScreen(civ.x, (civ.y || 0) + 2.3 * ZOMBIE_VISUAL_SCALE, civ.z);
        return (
          <div
            key={`civ_tag_${civ.id}`}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-25"
            style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
          >
            <div className="px-2.5 py-0.5 rounded-lg bg-cyan-500/90 border-2 border-white text-slate-950 font-display font-bold text-xs tracking-wider flex items-center gap-1 shadow-lg whitespace-nowrap">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>FRIENDLY</span>
            </div>
          </div>
        );
      })}

      {/* Phase 6: Boss Weak-Point Target Reticle (Crisp outline, no glow halo) */}
      {activeBosses
        .filter((b) => b.weakPoint?.active)
        .map((boss) => {
          const wpY = (boss.y || 0) + (boss.weakPoint?.offsetY || 2.4) * ZOMBIE_VISUAL_SCALE;
          const pos = projectToScreen(boss.x, wpY, boss.z);
          return (
            <div
              key={`boss_wp_${boss.id}`}
              className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-25"
              style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
            >
              <div className="w-14 h-14 rounded-full border-2 border-dashed border-amber-300 flex items-center justify-center animate-pulse">
                <div className="px-1.5 py-0.5 rounded bg-fuchsia-700 border border-amber-300 text-[0.65rem] font-mono font-extrabold text-amber-200 whitespace-nowrap">
                  CRITICAL
                </div>
              </div>
            </div>
          );
        })}

      {/* Downed Teammates 10-Second "SHOOT TO REVIVE!" Target Beacons */}
      {downedPlayers.map((dp) => {
        const bx = Math.max(0.15, Math.min(0.85, 0.15 + ((dp.slot - 1) % 5) * 0.175));
        const by = 0.72;
        return (
          <div
            key={`revive_${dp.id}`}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30"
            style={{ left: `${bx * 100}%`, top: `${by * 100}%` }}
          >
            <div className="px-4 py-2 rounded-2xl bg-rose-600/90 backdrop-blur-md border-2 border-amber-300 text-center shadow-xl whitespace-nowrap">
              <div className="flex items-center justify-center gap-1.5 font-display font-bold text-sm text-white">
                <HeartPulse className="w-4 h-4 text-amber-300" />
                <span>
                  {dp.slot}P {dp.name} DOWN · SHOOT TO REVIVE ({Math.ceil(dp.downedRemainingSec)}s)
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* =====================================================================
          PHASE 2 FLOATING SCORE POPUPS:
          One popup per target, merged in place on rapid hits, floating up & fading in ~0.8s.
         ===================================================================== */}
      {hitPopups.map((popup) => (
        <div
          key={`${popup.targetKey}_${popup.updatedAt}`}
          className="absolute pointer-events-none animate-arcade-popup text-center z-30"
          style={{
            left: `${popup.x * 100}%`,
            top: `${popup.y * 100}%`,
          }}
        >
          <div
            className="font-display font-extrabold italic text-[1.65rem] tracking-wider whitespace-nowrap px-2 py-0.5 rounded"
            style={{
              color: popup.headshot ? '#ffea00' : popup.color,
              WebkitTextStroke: '1.2px rgba(2, 6, 23, 0.98)',
            }}
          >
            {popup.text}
          </div>
        </div>
      ))}

      {/* =====================================================================
          PHASE 4 LIGHT-GUN CROSSHAIRS:
          Larger (5rem / 80px), player-colored with thin dark outline for crisp 4K contrast,
          short fading trail, subtle pulse on hit, and compact player name tag.
         ===================================================================== */}
      {connectedPlayers.map((player) => {
        const cx = `${player.crosshair.x * 100}%`;
        const cy = `${player.crosshair.y * 100}%`;
        const isHitTarget = lastHitPlayerId === player.id;
        const isLocked = Boolean(player.isTargetLocked);
        const crosshairStyle = player.equippedCrosshair || 'crosshair_default';
        const trail = trailHistoryRef.current[player.id] || [];

        return (
          <React.Fragment key={player.id}>
            {/* Short Fading Crosshair Trail */}
            {trail.slice(0, -1).map((pt, tIdx) => {
              const alpha = (tIdx + 1) / trail.length;
              return (
                <div
                  key={`${player.id}_trail_${tIdx}`}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-25 rounded-full"
                  style={{
                    left: `${pt.x * 100}%`,
                    top: `${pt.y * 100}%`,
                    width: `${8 + tIdx * 3}px`,
                    height: `${8 + tIdx * 3}px`,
                    backgroundColor: player.color,
                    border: '1.5px solid #020617',
                    opacity: alpha * 0.42,
                  }}
                />
              );
            })}

            <div
              className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-transform duration-75 ease-out z-30"
              style={{ left: cx, top: cy }}
            >
              <div className="relative w-20 h-20 flex items-center justify-center">
                <svg
                  viewBox="0 0 64 64"
                  className={`w-20 h-20 transition-transform duration-100 ${
                    isHitTarget ? 'scale-125' : isLocked ? 'scale-110' : 'scale-100'
                  }`}
                >
                  {crosshairStyle === 'crosshair_diamond' ? (
                    <>
                      {/* Dark Contrast Outline Underlayer */}
                      <polygon
                        points="32,5 59,32 32,59 5,32"
                        fill="none"
                        stroke="#020617"
                        strokeWidth="6"
                      />
                      <polygon
                        points="32,5 59,32 32,59 5,32"
                        fill="none"
                        stroke={isLocked ? '#ffbe0b' : player.color}
                        strokeWidth="3.2"
                      />
                      <polygon
                        points="32,16 48,32 32,48 16,32"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="1.8"
                      />
                    </>
                  ) : crosshairStyle === 'crosshair_star' ? (
                    <>
                      <circle
                        cx="32"
                        cy="32"
                        r="21"
                        fill="none"
                        stroke="#020617"
                        strokeWidth="5.5"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="21"
                        fill="none"
                        stroke={isLocked ? '#ffbe0b' : player.color}
                        strokeWidth="3"
                      />
                      <path
                        d="M32 6 L36 26 L56 32 L36 38 L32 58 L28 38 L8 32 L28 26 Z"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                    </>
                  ) : (
                    <>
                      {/* Dark Contrast Outline Underlayer */}
                      <path
                        d="M7 21 V7 H21 M43 7 H57 V21 M57 43 V57 H43 M21 57 H7 V43"
                        fill="none"
                        stroke="#020617"
                        strokeWidth="6.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M7 21 V7 H21 M43 7 H57 V21 M57 43 V57 H43 M21 57 H7 V43"
                        fill="none"
                        stroke={isLocked ? '#ffbe0b' : player.color}
                        strokeWidth="3.5"
                        strokeLinecap="round"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="14"
                        fill="none"
                        stroke="#020617"
                        strokeWidth="4.2"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="14"
                        fill="none"
                        stroke={isLocked ? '#ff0055' : '#ffffff'}
                        strokeWidth="2"
                        strokeDasharray="6 4"
                      />
                    </>
                  )}
                  <line x1="32" y1="3" x2="32" y2="14" stroke="#020617" strokeWidth="4.5" />
                  <line x1="32" y1="50" x2="32" y2="61" stroke="#020617" strokeWidth="4.5" />
                  <line x1="3" y1="32" x2="14" y2="32" stroke="#020617" strokeWidth="4.5" />
                  <line x1="50" y1="32" x2="61" y2="32" stroke="#020617" strokeWidth="4.5" />

                  <line x1="32" y1="3" x2="32" y2="14" stroke={player.color} strokeWidth="2.4" />
                  <line x1="32" y1="50" x2="32" y2="61" stroke={player.color} strokeWidth="2.4" />
                  <line x1="3" y1="32" x2="14" y2="32" stroke={player.color} strokeWidth="2.4" />
                  <line x1="50" y1="32" x2="61" y2="32" stroke={player.color} strokeWidth="2.4" />

                  <circle cx="32" cy="32" r="5" fill="#020617" />
                  <circle cx="32" cy="32" r="3.6" fill={isLocked ? '#ffbe0b' : player.color} />
                </svg>

                {isHitTarget && (
                  <div className="absolute inset-0 flex items-center justify-center font-display font-bold text-2xl text-amber-300">
                    ✕
                  </div>
                )}
              </div>

              {/* Small High-Contrast Player Name Tag Under Reticle */}
              <div
                className="absolute left-1/2 top-[4.75rem] transform -translate-x-1/2 whitespace-nowrap px-2.5 py-0.5 rounded-md text-xs font-display font-extrabold tracking-wider backdrop-blur-md flex items-center gap-1 shadow-md"
                style={{
                  backgroundColor: 'rgba(2, 6, 23, 0.85)',
                  border: `1.5px solid ${player.color}`,
                  color: '#ffffff',
                }}
              >
                <span style={{ color: player.color }}>{player.slot}P</span>
                <span className="max-w-[5.6rem] truncate">{player.name}</span>
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {/* =====================================================================
          PHASE 1, 2 & 3 BOTTOM PLAYER CARDS & TURRET TOASTS:
          One card per connected player (1..8) anchored at their foreground turret,
          with large TV-legible fonts, in-place MAX-capped streak bar/badge,
          and small weapon-crate pickup toast above the turret!
         ===================================================================== */}
      {connectedPlayers.length > 0 && (
        <div className="relative w-full h-24 pointer-events-none z-25">
          {connectedPlayers.map((p, idx) => {
            const screenX = getTurretScreenX(idx, connectedPlayers.length);
            const formattedScore = String(p.stats.score).padStart(6, '0');
            const isUnlimited = p.unlimitedAmmo ?? world.settings.unlimitedAmmo;
            const needsReload = !isUnlimited && (p.ammo === 0 || p.isReloading);
            const weaponDef = WEAPONS[p.weapon] || WEAPONS.pistol;
            const isCompact = connectedPlayers.length >= 6;
            const streak = formatStreakBadge(p.multiplier, p.combo);
            const playerToast = turretToasts.find(
              (t) => t.playerId === p.id || t.slot === p.slot
            );

            return (
              <div
                key={p.id}
                className="absolute bottom-0 transform -translate-x-1/2 pointer-events-auto transition-all duration-150 flex flex-col items-center"
                style={{
                  left: `${screenX * 100}%`,
                }}
              >
                {/* Phase 3: Small Weapon-Crate Pickup Toast Near This Player's Turret */}
                {playerToast && (
                  <div
                    className="mb-1.5 px-3 py-1 rounded-xl bg-slate-950/90 backdrop-blur-md border-2 text-xs font-display font-extrabold tracking-wider whitespace-nowrap shadow-xl animate-bounce"
                    style={{
                      borderColor: playerToast.color,
                      color: playerToast.color,
                    }}
                  >
                    {playerToast.text}
                  </div>
                )}

                <div
                  className={`bg-slate-950/85 backdrop-blur-md rounded-2xl border-2 flex flex-col items-center text-center shadow-xl ${
                    isCompact
                      ? 'px-2.5 py-1.5 min-w-[8rem] max-w-[9.25rem]'
                      : 'px-4 py-2 min-w-[11.8rem] max-w-[14.7rem]'
                  }`}
                  style={{
                    borderColor: p.isDowned ? '#f43f5e' : p.color,
                  }}
                >
                  {/* Row 1: Player Slot + Name + In-Place Hit Streak Badge (capped with MAX) */}
                  <div className="w-full flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="font-display font-extrabold text-xs px-1.5 py-0.5 rounded-md shrink-0"
                        style={{
                          backgroundColor: `${p.color}30`,
                          border: `1px solid ${p.color}`,
                          color: p.color,
                        }}
                      >
                        {p.slot}P
                      </span>
                      <span className="font-display font-bold text-sm text-white truncate">
                        {p.name}
                      </span>
                    </div>

                    {/* Phase 2: In-Place Hit Streak Multiplier Badge with MAX Cap */}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[0.7rem] font-mono font-extrabold shrink-0 border ${
                        streak.isMax
                          ? 'bg-amber-400 text-slate-950 border-white'
                          : p.multiplier > 1
                          ? 'bg-amber-500/25 text-amber-300 border-amber-400/80'
                          : 'bg-white/10 text-white/65 border-white/15'
                      }`}
                    >
                      {streak.label}
                    </span>
                  </div>

                  {/* Row 2: Large TV-Legible Score (scales with 4K root rem) */}
                  <div
                    className={`w-full font-mono font-extrabold tabular-nums tracking-tight leading-none my-0.5 ${
                      isCompact ? 'text-xl' : 'text-[1.65rem]'
                    }`}
                    style={{ color: p.color }}
                  >
                    {formattedScore}
                  </div>

                  {/* Row 3: Weapon & High-Contrast Ammo Readout + Streak Progress Bar */}
                  <div className="w-full flex items-center justify-between gap-1.5 text-xs font-mono text-white pt-1 border-t border-white/15">
                    {p.isDowned ? (
                      <span className="text-rose-400 font-extrabold animate-pulse mx-auto">
                        DOWN ({Math.ceil(p.downedRemainingSec)}s)
                      </span>
                    ) : needsReload ? (
                      <span className="text-amber-300 font-extrabold animate-pulse mx-auto">
                        RELOADING...
                      </span>
                    ) : (
                      <>
                        <span style={{ color: weaponDef.color }} className="font-extrabold truncate">
                          {weaponDef.shortName}
                        </span>
                        <span className="font-extrabold text-sm text-white tabular-nums">
                          {isUnlimited || weaponDef.infiniteAmmo
                            ? `${p.ammo}/∞`
                            : `${p.ammo}/${p.maxAmmo}`}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Subtle In-Place Streak Progress Bar */}
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full transition-all duration-150"
                      style={{
                        width: `${streak.progressPct}%`,
                        backgroundColor: streak.isMax ? '#facc15' : p.color,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
