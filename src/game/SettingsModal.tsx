import React from 'react';
import { GameSettings, ThemeId, GameDifficulty, ScareLevel } from '../../shared/types.ts';
import themesData from '../../shared/themes.json' with { type: 'json' };
import {
  X,
  Sparkles,
  Skull,
  Shield,
  Check,
  Crosshair,
  RefreshCw,
  Infinity as InfinityIcon,
  Volume2,
  VolumeX,
  Flame,
  Smartphone,
} from 'lucide-react';

interface SettingsModalProps {
  settings: GameSettings;
  isOpen: boolean;
  isMuted?: boolean;
  onToggleMute?: () => void;
  onClose: () => void;
  onSave: (newSettings: Partial<GameSettings>) => void;
  onBackToMenu?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  isMuted = false,
  onToggleMute,
  onClose,
  onSave,
  onBackToMenu,
}) => {
  if (!isOpen) return null;

  const themes = themesData.themes as Record<string, { name: string; description: string }>;

  return (
    <div className="fixed inset-0 bg-slate-950/88 z-50 flex items-center justify-center p-4 sm:p-6 select-none font-sans overflow-y-auto">
      <div className="bg-slate-900 border-2 border-cyan-400/50 rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 my-auto max-h-[94vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-amber-400" />
            <h2 className="font-display text-xl font-bold tracking-wider text-white">
              ARCADE CABINET & AUDIO OPTIONS
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. Audio Mixer Sliders (Master, Music, Effects, Voice) + Mute (M) */}
        <div className="bg-slate-950/90 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-display font-bold tracking-wider text-cyan-300 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <span>SOUND MIXER & SPATIAL AUDIO (SAVED TO LOCALSTORAGE)</span>
            </label>
            <div className="flex items-center gap-2">
              {onToggleMute && (
                <button
                  type="button"
                  onClick={onToggleMute}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border flex items-center gap-1.5 transition cursor-pointer ${
                    isMuted
                      ? 'bg-rose-950/80 border-rose-400 text-rose-300'
                      : 'bg-slate-900 border-white/15 text-emerald-300 hover:border-white/30'
                  }`}
                >
                  {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>{isMuted ? 'MUTED (Key M)' : 'MUTE (Key M)'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Master Volume */}
            <div className="bg-slate-900/80 p-2.5 rounded-xl border border-white/5">
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-200 font-bold">MASTER VOLUME</span>
                <span className="text-cyan-300">
                  {Math.round((settings.masterVolume ?? 0.85) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={settings.masterVolume ?? 0.85}
                onChange={(e) => onSave({ masterVolume: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Music & Ambience Volume */}
            <div className="bg-slate-900/80 p-2.5 rounded-xl border border-white/5">
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-200 font-bold">MUSIC & AMBIENCE</span>
                <span className="text-fuchsia-300">
                  {Math.round((settings.musicVolume ?? 0.55) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={settings.musicVolume ?? 0.55}
                onChange={(e) => onSave({ musicVolume: parseFloat(e.target.value) })}
                className="w-full accent-fuchsia-400 cursor-pointer"
              />
            </div>

            {/* Weapon & Combat Effects Volume */}
            <div className="bg-slate-900/80 p-2.5 rounded-xl border border-white/5">
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-200 font-bold">EFFECTS (GUNS & IMPACTS)</span>
                <span className="text-amber-300">
                  {Math.round((settings.sfxVolume ?? 0.9) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={settings.sfxVolume ?? 0.9}
                onChange={(e) => onSave({ sfxVolume: parseFloat(e.target.value) })}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            {/* 3D Zombie Voices & Announcer Volume */}
            <div className="bg-slate-900/80 p-2.5 rounded-xl border border-white/5">
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-200 font-bold">ZOMBIE VOICES & ANNOUNCER</span>
                <span className="text-emerald-300">
                  {Math.round((settings.voiceVolume ?? 0.85) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={settings.voiceVolume ?? 0.85}
                onChange={(e) => onSave({ voiceVolume: parseFloat(e.target.value) })}
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Phone Speaker Hit Confirmation Tick Toggle */}
          <div className="flex items-center justify-between pt-1 border-t border-white/10">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Smartphone className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Play Hit-Confirmation Audio Tick on Shooter&apos;s Phone Speaker</span>
            </div>
            <button
              type="button"
              onClick={() => onSave({ phoneHitSound: !(settings.phoneHitSound ?? true) })}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                settings.phoneHitSound ?? true
                  ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300'
                  : 'bg-slate-900 border-white/15 text-slate-400'
              }`}
            >
              {(settings.phoneHitSound ?? true) ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* 2. Content Rating / Mode: Kids vs Adult + Scare Level */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-7">
            <label className="block text-xs font-display font-bold tracking-wider text-amber-400 mb-2">
              ATMOSPHERE & GORE MODE
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onSave({ mode: 'adult' })}
                className={`p-3 rounded-2xl border-2 text-left transition flex items-start gap-2.5 cursor-pointer ${
                  settings.mode === 'adult'
                    ? 'bg-fuchsia-950/60 border-fuchsia-400'
                    : 'bg-slate-950 border-white/10 opacity-75 hover:opacity-100'
                }`}
              >
                <Skull className="w-5 h-5 text-fuchsia-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-display font-bold text-xs text-white flex items-center gap-1">
                    Adult Horror{' '}
                    {settings.mode === 'adult' && <Check className="w-3.5 h-3.5 text-fuchsia-400" />}
                  </div>
                  <div className="text-[10px] text-slate-300 mt-0.5 leading-tight">
                    Dark ambience, 3D growls, blood &lt;30% HP heartbeat.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onSave({ mode: 'kids' })}
                className={`p-3 rounded-2xl border-2 text-left transition flex items-start gap-2.5 cursor-pointer ${
                  settings.mode === 'kids'
                    ? 'bg-emerald-950/60 border-emerald-400'
                    : 'bg-slate-950 border-white/10 opacity-75 hover:opacity-100'
                }`}
              >
                <Sparkles className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-display font-bold text-xs text-white flex items-center gap-1">
                    Kids Mode{' '}
                    {settings.mode === 'kids' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <div className="text-[10px] text-slate-300 mt-0.5 leading-tight">
                    Slime &amp; confetti, goofy cartoon voices, no heartbeat.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Scare Level (Low / Medium / High) */}
          <div className="sm:col-span-5">
            <label className="block text-xs font-display font-bold tracking-wider text-amber-400 mb-2 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-rose-400" />
              <span>SCARE INTENSITY LEVEL</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'medium', 'high'] as ScareLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => onSave({ scareLevel: lvl })}
                  className={`py-3 px-2 rounded-2xl border-2 font-display font-bold text-xs uppercase tracking-wider transition cursor-pointer flex flex-col items-center justify-center ${
                    (settings.scareLevel || 'medium') === lvl
                      ? 'bg-rose-950/80 border-rose-400 text-rose-200'
                      : 'bg-slate-950 border-white/10 text-slate-400 hover:border-white/30'
                  }`}
                >
                  <span>{lvl}</span>
                  <span className="text-[9px] font-mono opacity-75 mt-0.5">
                    {lvl === 'low' ? 'Mild' : lvl === 'medium' ? 'Arcade' : 'Intense'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3. Light-Gun Assist & Firing Mode */}
        <div>
          <label className="block text-xs font-display font-bold tracking-wider text-amber-400 mb-2">
            LIGHT-GUN ASSIST & FIRING MODE
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => onSave({ autoFire: !settings.autoFire })}
              className={`p-2.5 rounded-xl border-2 text-left transition cursor-pointer ${
                settings.autoFire
                  ? 'bg-emerald-950/70 border-emerald-400'
                  : 'bg-slate-950 border-white/10 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between text-emerald-400 mb-0.5">
                <Crosshair className="w-3.5 h-3.5" />
                <span className="font-mono text-[10px] font-bold">
                  {settings.autoFire ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="font-display font-bold text-xs text-white">AUTO-FIRE</div>
            </button>

            <button
              type="button"
              onClick={() => onSave({ autoReload: !settings.autoReload })}
              className={`p-2.5 rounded-xl border-2 text-left transition cursor-pointer ${
                settings.autoReload
                  ? 'bg-cyan-950/70 border-cyan-400'
                  : 'bg-slate-950 border-white/10 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between text-cyan-400 mb-0.5">
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="font-mono text-[10px] font-bold">
                  {settings.autoReload ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="font-display font-bold text-xs text-white">AUTO-RELOAD</div>
            </button>

            <button
              type="button"
              onClick={() => onSave({ unlimitedAmmo: !settings.unlimitedAmmo })}
              className={`p-2.5 rounded-xl border-2 text-left transition cursor-pointer ${
                settings.unlimitedAmmo
                  ? 'bg-amber-950/70 border-amber-400'
                  : 'bg-slate-950 border-white/10 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between text-amber-400 mb-0.5">
                <InfinityIcon className="w-3.5 h-3.5" />
                <span className="font-mono text-[10px] font-bold">
                  {settings.unlimitedAmmo ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="font-display font-bold text-xs text-white">UNLIMITED FIRE</div>
            </button>
          </div>
        </div>

        {/* 4. 3D GLB Zombie Themes from shared/themes.json */}
        <div>
          <label className="block text-xs font-display font-bold tracking-wider text-amber-400 mb-2">
            3D GLB CHARACTER THEME & VOICE SET
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {(Object.keys(themes) as ThemeId[]).map((themeKey) => {
              const th = themes[themeKey];
              const isSelected = settings.theme === themeKey;

              return (
                <button
                  key={themeKey}
                  type="button"
                  onClick={() => onSave({ theme: themeKey })}
                  className={`p-2.5 rounded-xl border-2 text-left transition cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-950/70 border-cyan-400'
                      : 'bg-slate-950 border-white/10 opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="font-display font-bold text-xs text-white tracking-wider mb-0.5">
                    {th.name}
                  </div>
                  <div className="text-[10px] text-slate-300 line-clamp-2 leading-tight">
                    {th.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Difficulty & Stages */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-display font-bold tracking-wider text-amber-400 mb-1.5">
              ARCADE DIFFICULTY
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['easy', 'normal', 'hard'] as GameDifficulty[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onSave({ difficulty: d })}
                  className={`py-2 rounded-xl border-2 font-display font-bold text-xs uppercase tracking-wider transition cursor-pointer ${
                    settings.difficulty === d
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-slate-950 border-white/10 text-slate-300'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-display font-bold tracking-wider text-amber-400 mb-1.5">
              STAGES TO CLEAR
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[3, 5, 10].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onSave({ maxWaves: w })}
                  className={`py-2 rounded-xl border-2 text-xs font-mono font-bold transition cursor-pointer ${
                    settings.maxWaves === w
                      ? 'bg-cyan-400 text-slate-950 border-cyan-300'
                      : 'bg-slate-950 border-white/10 text-slate-300'
                  }`}
                >
                  {w} Stages
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 6. Post-Processing Visual Quality Toggle (Auto-Fallback Supported) */}
        <div className="bg-slate-950/80 border border-white/10 p-3 rounded-xl flex items-center justify-between gap-3">
          <div>
            <div className="font-display font-bold text-xs text-cyan-300">
              POST-PROCESSING GRAPHICS (BLOOM + VIGNETTE + FILM GRAIN)
            </div>
            <div className="text-[10px] text-slate-400">
              Automatically falls back to Low if FPS drops on low-end PCs
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(['high', 'low'] as const).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSave({ postProcessingQuality: q })}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase border transition cursor-pointer ${
                  (settings.postProcessingQuality || 'high') === q
                    ? 'bg-cyan-400 text-slate-950 border-cyan-300'
                    : 'bg-slate-900 border-white/15 text-slate-300'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard Debug Shortcuts Info */}
        <div className="bg-slate-950/80 border border-white/10 px-3.5 py-2 rounded-xl flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-300">
          <span>
            <strong className="text-emerald-300">[F3]</strong> Perf &amp; Tick Overlay
          </span>
          <span>
            <strong className="text-amber-300">[Key H]</strong> 3D Hitboxes
          </span>
          <span>
            <strong className="text-cyan-300">[Key K]</strong> Preview Audio
          </span>
          <span>
            <strong className="text-rose-300">[Key M]</strong> Mute All
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          {onBackToMenu && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBackToMenu();
              }}
              className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-950 hover:bg-slate-800 border-2 border-amber-400/70 text-amber-300 font-display font-bold tracking-wider text-sm transition cursor-pointer whitespace-nowrap"
            >
              ◀ BACK TO ARCADE MENU
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-display font-bold tracking-wider text-base transition cursor-pointer"
          >
            SAVE & RETURN TO ARCADE
          </button>
        </div>
      </div>
    </div>
  );
};
