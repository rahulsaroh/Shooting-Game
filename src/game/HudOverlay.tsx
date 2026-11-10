import React from 'react';
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
} from 'lucide-react';
import { WEAPONS, ZOMBIE_VISUAL_SCALE } from '../../shared/config.ts';

export interface ArcadeHitPopup {
  id: string;
  x: number;
  y: number;
  text: string;
  subtext?: string;
  color: string;
  headshot: boolean;
}

interface HudOverlayProps {
  world: GameWorldState;
  soundEnabled: boolean;
  musicEnabled: boolean;
  onToggleSound: () => void;
  onToggleMusic: () => void;
  onReturnLobby?: () => void;
  onSkipTutorial?: () => void;
  onUpdateSettings?: (settings: Partial<GameSettings>) => void;
  lastHitPlayerId?: string | null;
  hitPopups?: ArcadeHitPopup[];
}

// Helper to project 3D world coordinates to normalized 2D screen coordinates for HUD callouts
function projectToScreen(x: number, y: number, z: number, aspect = 16 / 9) {
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
    x: Math.max(0.05, Math.min(0.95, 0.5 + (xCam / zCam) * focalX)),
    y: Math.max(0.08, Math.min(0.92, 0.5 - (yCam / zCam) * focalY)),
  };
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  world,
  soundEnabled,
  musicEnabled,
  onToggleSound,
  onToggleMusic,
  onReturnLobby,
  onSkipTutorial,
  onUpdateSettings,
  lastHitPlayerId,
  hitPopups = [],
}) => {
  const barricadePct = Math.max(
    0,
    Math.min(100, (world.barricadeHp / world.maxBarricadeHp) * 100)
  );
  const isDanger = barricadePct < 30;
  const totalSegments = 16;
  const filledSegments = Math.ceil((barricadePct / 100) * totalSegments);

  // Only show actively connected players/hosts
  const connectedPlayers = world.players.filter((p) => p.isConnected);
  const downedPlayers = connectedPlayers.filter((p) => p.isDowned);

  // Zombies currently at point-blank range scratching the screen
  const scratchingZombies = world.zombies.filter((z) => z.state === 'attacking');
  const isBeingScratched = scratchingZombies.length > 0;

  // Civilians and Bosses with active Weak Points
  const activeCivilians = world.zombies.filter((z) => z.isCivilian && z.state !== 'dying');
  const activeBosses = world.zombies.filter(
    (z) => z.type === 'boss' && z.weakPoint?.active && z.state !== 'dying'
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between p-4 select-none overflow-hidden font-sans">
      {/* Slow-Motion Boss Kill Cinema Banner */}
      {(world.slowMoRemainingMs || 0) > 0 && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-40 pointer-events-none">
          <div className="px-8 py-2 rounded-2xl bg-fuchsia-600/80 backdrop-blur-md border-2 border-amber-300 text-white font-display font-bold text-2xl tracking-widest italic animate-pulse shadow-2xl">
            ⚡ BOSS ELIMINATED · SLOW-MOTION FINISH! ⚡
          </div>
        </div>
      )}

      {/* Full-Screen Zombie Claw Scratch Overlay when zombies reach point-blank range */}
      {isBeingScratched && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              boxShadow: 'inset 0 0 45px 10px rgba(244, 63, 94, 0.25)',
            }}
          />

          {scratchingZombies.map((z, idx) => {
            const normX = Math.max(0.18, Math.min(0.82, 0.5 + z.x * 0.14));
            return (
              <div
                key={z.id}
                className="absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] opacity-70"
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

      {/* Top Perimeter Glass Status Bar (TV-distance legible high contrast) */}
      <div className="flex flex-wrap items-center justify-between gap-3 pl-28 z-20">
        {/* Top-Left: Stage & Quick Assist Toggles */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          <div className="bg-slate-950/45 backdrop-blur-md border border-white/25 px-4 py-1.5 rounded-xl flex items-center gap-3">
            <div>
              <div className="text-[10px] font-display font-bold tracking-widest text-cyan-300 uppercase">
                {world.stageName || `STAGE ${ (world.stageIndex ?? 0) + 1 }`}
              </div>
              <div className="font-display text-xl font-bold tracking-wider text-white tabular-nums leading-none">
                WAVE 0{world.currentWave}
                <span className="text-white/60 text-xs font-mono">
                  /0{world.settings.maxWaves}
                </span>
              </div>
            </div>

            {(world.effects.freezeRemainingMs > 0 ||
              world.effects.doubleDamageRemainingMs > 0) && (
              <div className="flex items-center gap-1.5 border-l border-white/15 pl-2.5">
                {world.effects.freezeRemainingMs > 0 && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 text-xs font-mono font-bold tabular-nums">
                    <Snowflake className="w-3.5 h-3.5" />
                    <span>{(world.effects.freezeRemainingMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
                {world.effects.doubleDamageRemainingMs > 0 && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-fuchsia-500/20 border border-fuchsia-400/50 text-amber-200 text-xs font-mono font-bold tabular-nums">
                    <Flame className="w-3.5 h-3.5" />
                    <span>2X {(world.effects.doubleDamageRemainingMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Translucent Glass Quick-Toggles for Auto-Fire, Auto-Reload, Unlimited Fire */}
          {onUpdateSettings && (
            <div className="bg-slate-950/35 backdrop-blur-md border border-white/20 p-1 rounded-xl flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateSettings({ autoFire: !world.settings.autoFire })}
                className={`px-2.5 py-1 rounded-lg text-xs font-display font-bold tracking-wider flex items-center gap-1 transition cursor-pointer ${
                  world.settings.autoFire
                    ? 'bg-emerald-500/30 border border-emerald-400/70 text-emerald-200'
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
                    ? 'bg-cyan-500/30 border border-cyan-400/70 text-cyan-200'
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
                    ? 'bg-amber-500/30 border border-amber-400/70 text-amber-200'
                    : 'bg-white/5 text-white/60 hover:text-white'
                }`}
              >
                <InfinityIcon className="w-3.5 h-3.5" />
                <span>UNLIMITED: {world.settings.unlimitedAmmo ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Top-Center: Translucent Glass Shield Barricade Gauge */}
        <div className="w-full max-w-sm bg-slate-950/40 backdrop-blur-md border border-white/25 px-3.5 py-2 rounded-xl">
          <div className="flex items-center justify-between text-xs font-display font-bold mb-1">
            <span className="flex items-center gap-1.5 text-amber-300 tracking-wider">
              <Shield className={`w-4 h-4 ${isDanger ? 'text-rose-400' : 'text-cyan-300'}`} />
              {isBeingScratched ? '⚠️ ZOMBIE SCRATCHING!' : 'FORCEFIELD HP'}
            </span>
            <span
              className={`font-mono font-extrabold text-sm tabular-nums ${
                isDanger ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              {world.barricadeHp} / {world.maxBarricadeHp}
            </span>
          </div>

          <div className="grid grid-cols-16 gap-1 bg-black/30 p-1 rounded-md border border-white/10">
            {Array.from({ length: totalSegments }).map((_, idx) => {
              const active = idx < filledSegments;
              let cellColor = 'bg-white/10';
              if (active) {
                if (isDanger) cellColor = 'bg-rose-500';
                else if (idx < 6) cellColor = 'bg-emerald-400/90';
                else if (idx < 12) cellColor = 'bg-cyan-400/90';
                else cellColor = 'bg-amber-400/90';
              }
              return <div key={idx} className={`h-2.5 rounded-xs transition-all ${cellColor}`} />;
            })}
          </div>
        </div>

        {/* Top-Right: Glass Audio & Lobby Controls */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={onToggleSound}
            className={`p-2 rounded-xl backdrop-blur-md border transition active:scale-95 cursor-pointer ${
              soundEnabled
                ? 'bg-slate-950/35 border-white/20 text-cyan-300 hover:bg-white/10'
                : 'bg-rose-950/40 border-rose-400/50 text-rose-300'
            }`}
            title="Toggle Sound Effects"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onToggleMusic}
            className={`p-2 rounded-xl backdrop-blur-md border transition active:scale-95 cursor-pointer ${
              musicEnabled
                ? 'bg-slate-950/35 border-white/20 text-fuchsia-300 hover:bg-white/10'
                : 'bg-slate-950/35 border-white/10 text-white/40'
            }`}
            title="Toggle Arcade Synth Music"
          >
            <Music className="w-4 h-4" />
          </button>
          {onReturnLobby && (
            <button
              type="button"
              onClick={onReturnLobby}
              className="px-3 py-1.5 rounded-xl bg-slate-950/35 hover:bg-white/10 backdrop-blur-md border border-white/20 text-xs font-display font-bold text-white flex items-center gap-1.5 transition active:scale-95 cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-300" />
              <span>Lobby</span>
            </button>
          )}
        </div>
      </div>

      {/* Phase D: Short Interactive Tutorial Banner before Wave 1 */}
      {world.phase === 'TUTORIAL' && (
        <div className="my-auto text-center z-20 pointer-events-auto">
          <div className="inline-block bg-slate-950/65 backdrop-blur-md border-2 border-cyan-400 px-8 py-5 rounded-3xl max-w-2xl space-y-2 shadow-2xl">
            <div className="font-display text-sm font-bold tracking-widest text-amber-300">
              INTERACTIVE LIGHT-GUN CALIBRATION ({world.countdownSeconds}s)
            </div>
            <div className="font-display text-3xl font-bold italic text-white tracking-wider">
              HOLD PHONE FLAT FOR CENTER · SHOOT THE TARGETS!
            </div>
            <div className="text-sm text-cyan-200 font-mono">
              Tilt Left/Right/Up/Down to Aim · Shake Phone to Reload · Avoid Blue Civilians!
            </div>
            {onSkipTutorial && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onSkipTutorial}
                  className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm tracking-wider inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <FastForward className="w-4 h-4" />
                  <span>SKIP TUTORIAL &amp; START WAVE 1</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Center Stage Banners (Countdown, Bonus Round, & Stage Clear) */}
      {world.phase === 'COUNTDOWN' && (
        <div className="my-auto text-center pointer-events-none z-20">
          <div className="inline-block bg-slate-950/55 backdrop-blur-md border-2 border-amber-400/80 px-10 py-5 rounded-3xl">
            <div className="font-display text-base font-bold tracking-widest text-cyan-300">
              {world.stageName} · WAVE 0{world.currentWave}
            </div>
            <div className="font-display text-7xl font-bold italic text-amber-300 tabular-nums my-1">
              {world.countdownSeconds}
            </div>
            <div className="font-display text-xl font-bold tracking-wider text-white">
              HOLD PHONE FLAT FOR CENTER · POINT AT ZOMBIES TO AUTO-FIRE!
            </div>
          </div>
        </div>
      )}

      {world.phase === 'BONUS_ROUND' && (
        <div className="mx-auto mt-2 text-center pointer-events-none z-20">
          <div className="inline-block bg-fuchsia-950/65 backdrop-blur-md border-2 border-amber-400 px-8 py-3 rounded-2xl">
            <div className="font-display text-2xl font-bold italic text-amber-300 tracking-wider">
              🎯 BONUS GALLERY ROUND! ({world.intermissionCountdown}s) 🎯
            </div>
            <div className="text-xs font-mono text-white">
              SHOOT FLYING DRONES &amp; WEAPON CRATES FOR BONUS SCORE &amp; HEAVY WEAPONS!
            </div>
          </div>
        </div>
      )}

      {world.phase === 'WAVE_CLEARED' && (
        <div className="my-auto text-center pointer-events-none z-20">
          <div className="inline-block bg-slate-950/55 backdrop-blur-md border-2 border-emerald-400/80 px-10 py-5 rounded-3xl">
            <div className="font-display text-sm font-bold tracking-widest text-amber-300">
              {world.stageName}
            </div>
            <div className="font-display text-5xl font-bold italic text-emerald-300 tracking-wider mt-1">
              WAVE 0{world.currentWave} CLEARED!
            </div>
            <div className="text-white/90 text-base font-mono mt-1.5">
              Next wave in{' '}
              <span className="font-extrabold text-amber-300 text-lg tabular-nums">
                {world.intermissionCountdown}s
              </span>
            </div>
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
            <div className="px-2.5 py-1 rounded-lg bg-cyan-500/85 border-2 border-white text-slate-950 font-display font-bold text-xs tracking-wider flex items-center gap-1 shadow-lg animate-bounce whitespace-nowrap">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>FRIENDLY · DON&apos;T SHOOT!</span>
            </div>
          </div>
        );
      })}

      {/* Boss Weak-Point Bullseye On-Screen Indicator */}
      {activeBosses.map((boss) => {
        const wpY = (boss.y || 0) + (boss.weakPoint?.offsetY || 2.4) * ZOMBIE_VISUAL_SCALE;
        const pos = projectToScreen(boss.x, wpY, boss.z);
        return (
          <div
            key={`boss_wp_${boss.id}`}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-25"
            style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
          >
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-fuchsia-400 flex items-center justify-center animate-pulse">
              <div className="px-2 py-0.5 rounded bg-fuchsia-600/80 text-[10px] font-mono font-extrabold text-amber-200 whitespace-nowrap">
                WEAK POINT
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
            <div className="px-4 py-2.5 rounded-2xl bg-rose-600/85 backdrop-blur-md border-2 border-amber-300 text-center shadow-2xl animate-bounce">
              <div className="flex items-center justify-center gap-1.5 font-display font-bold text-sm text-white">
                <HeartPulse className="w-4 h-4 text-amber-300" />
                <span>
                  {dp.slot}P {dp.name} DOWN!
                </span>
              </div>
              <div className="font-mono font-extrabold text-xs text-amber-200 mt-0.5">
                SHOOT HERE TO REVIVE ({Math.ceil(dp.downedRemainingSec)}s)
              </div>
            </div>
          </div>
        );
      })}

      {/* Floating Arcade Hit Score Popups */}
      {hitPopups.map((popup) => (
        <div
          key={popup.id}
          className="absolute pointer-events-none animate-arcade-popup text-center z-30"
          style={{
            left: `${popup.x * 100}%`,
            top: `${popup.y * 100}%`,
          }}
        >
          <div
            className="font-display font-bold italic text-2xl tracking-wider drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] whitespace-nowrap"
            style={{ color: popup.headshot ? '#ffea00' : popup.color }}
          >
            {popup.text}
          </div>
          {popup.subtext && (
            <div className="font-mono font-bold text-xs text-white bg-fuchsia-600/75 backdrop-blur-sm border border-white/30 px-2.5 py-0.5 rounded whitespace-nowrap">
              {popup.subtext}
            </div>
          )}
        </div>
      ))}

      {/* Connected Players' Light-Gun Reticles (Supports Unlockable Crosshair Styles!) */}
      {connectedPlayers.map((player) => {
        const cx = `${player.crosshair.x * 100}%`;
        const cy = `${player.crosshair.y * 100}%`;
        const isHitTarget = lastHitPlayerId === player.id;
        const isLocked = Boolean(player.isTargetLocked);
        const crosshairStyle = player.equippedCrosshair || 'crosshair_default';
        const weaponDef = WEAPONS[player.weapon] || WEAPONS.pistol;

        return (
          <div
            key={player.id}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-transform duration-75 ease-out z-30"
            style={{ left: cx, top: cy }}
          >
            <div className="relative w-16 h-16 flex items-center justify-center">
              <svg
                viewBox="0 0 64 64"
                className={`w-16 h-16 transition-transform duration-100 ${
                  isHitTarget ? 'scale-125' : isLocked ? 'scale-110' : 'scale-100'
                }`}
              >
                {crosshairStyle === 'crosshair_diamond' ? (
                  <>
                    <polygon
                      points="32,6 58,32 32,58 6,32"
                      fill="none"
                      stroke={isLocked ? '#ffbe0b' : player.color}
                      strokeWidth="3"
                    />
                    <polygon
                      points="32,16 48,32 32,48 16,32"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  </>
                ) : crosshairStyle === 'crosshair_star' ? (
                  <>
                    <circle
                      cx="32"
                      cy="32"
                      r="20"
                      fill="none"
                      stroke={isLocked ? '#ffbe0b' : player.color}
                      strokeWidth="2.5"
                    />
                    <path
                      d="M32 6 L36 26 L56 32 L36 38 L32 58 L28 38 L8 32 L28 26 Z"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                  </>
                ) : (
                  <>
                    <path
                      d="M8 20 V8 H20 M44 8 H56 V20 M56 44 V56 H44 M20 56 H8 V44"
                      fill="none"
                      stroke={isLocked ? '#ffbe0b' : player.color}
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="13"
                      fill="none"
                      stroke={isLocked ? '#ff0055' : '#ffffff'}
                      strokeWidth="1.8"
                      strokeDasharray="6 4"
                    />
                  </>
                )}
                <line x1="32" y1="4" x2="32" y2="14" stroke={player.color} strokeWidth="2" />
                <line x1="32" y1="50" x2="32" y2="60" stroke={player.color} strokeWidth="2" />
                <line x1="4" y1="32" x2="14" y2="32" stroke={player.color} strokeWidth="2" />
                <line x1="50" y1="32" x2="60" y2="32" stroke={player.color} strokeWidth="2" />
                <circle cx="32" cy="32" r="3.5" fill={isLocked ? '#ffbe0b' : player.color} />
              </svg>

              {isHitTarget && (
                <div className="absolute inset-0 flex items-center justify-center font-display font-bold text-2xl text-amber-300">
                  ✕
                </div>
              )}
            </div>

            {/* Translucent Glass Player Number + Weapon + Multiplier Tag under Reticle */}
            <div
              className="absolute left-1/2 top-15 transform -translate-x-1/2 whitespace-nowrap px-2.5 py-0.5 rounded-md text-xs font-display font-bold tracking-wider backdrop-blur-sm flex items-center gap-1.5"
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.45)',
                border: `1px solid ${player.color}99`,
                color: '#ffffff',
              }}
            >
              <span style={{ color: player.color }}>{player.slot}P</span>
              <span>{weaponDef.shortName}</span>
              {player.multiplier > 1 && (
                <span className="text-amber-300 font-extrabold">{player.multiplier}X</span>
              )}
            </div>
          </div>
        );
      })}

      {/* Bottom Connected Player Cards: Translucent Glass Bar (Only Connected Hosts!) */}
      {connectedPlayers.length > 0 && (
        <div className="w-full max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-3 pointer-events-auto z-20 pr-36">
          {connectedPlayers.map((p) => {
            const formattedScore = String(p.stats.score).padStart(6, '0');
            const isUnlimited = p.unlimitedAmmo ?? world.settings.unlimitedAmmo;
            const needsReload = !isUnlimited && (p.ammo === 0 || p.isReloading);
            const weaponDef = WEAPONS[p.weapon] || WEAPONS.pistol;

            return (
              <div
                key={p.id}
                className="bg-slate-950/32 backdrop-blur-md rounded-xl px-3.5 py-2 border flex items-center gap-3 min-w-[235px] max-w-[290px]"
                style={{
                  borderColor: p.isDowned ? '#f43f5e' : `${p.color}88`,
                }}
              >
                {/* Glass Player Number Pill */}
                <span
                  className="font-display font-bold text-sm px-2 py-0.5 rounded-md shrink-0 backdrop-blur-sm"
                  style={{
                    backgroundColor: `${p.color}22`,
                    border: `1px solid ${p.color}`,
                    color: p.color,
                  }}
                >
                  {p.slot}P
                </span>

                {/* Name, Weapon, Combo & Ammo/Status */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-display font-bold text-sm text-white truncate leading-tight">
                      {p.name}
                    </span>
                    {p.multiplier > 1 && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-400/25 border border-amber-300 text-amber-300 font-mono font-extrabold text-[10px]">
                        {p.multiplier}X ({p.combo})
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-white/85 flex items-center gap-1.5 leading-tight mt-0.5">
                    {p.isDowned ? (
                      <span className="text-rose-400 font-extrabold animate-pulse">
                        DOWNED ({Math.ceil(p.downedRemainingSec)}s)
                      </span>
                    ) : needsReload ? (
                      <span className="text-amber-300 font-bold">RELOADING...</span>
                    ) : (
                      <>
                        <span style={{ color: weaponDef.color }} className="font-bold">
                          {weaponDef.shortName}
                        </span>
                        <span>·</span>
                        <span>
                          {isUnlimited ? '∞' : `${p.ammo}/${p.maxAmmo}`}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Score (Large TV-legible digits) */}
                <span
                  className="font-mono font-extrabold text-base tabular-nums tracking-tight shrink-0"
                  style={{ color: p.color }}
                >
                  {formattedScore}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
