/**
 * Rich Horror & Arcade Web Audio Engine for DeadAim
 * - Loads and caches audio buffers from /public/audio/<category>/ via shared/audio.json
 * - 3D HRTF PannerNode spatialization for zombie voices (left/center/right + distance attenuation)
 * - 12-voice priority limiter (Boss & closest zombies first)
 * - 3-layer dynamic music (calm, tense, intense) + <30% HP heartbeat + looping ambient bed
 * - Master DynamicsCompressorNode limiter to prevent clipping
 * - Full procedural Web Audio API fallback if any sound file is missing
 */

import audioManifest from '../../shared/audio.json' with { type: 'json' };
import themesData from '../../shared/themes.json' with { type: 'json' };
import { ScareLevel, ThemeId, ZombieState, ZombieType } from '../../shared/types.ts';

export interface StoredAudioSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  muted: boolean;
  scareLevel: ScareLevel;
  phoneHitSound: boolean;
}

interface ActiveVoice {
  id: string;
  zombieId: string;
  priority: number;
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
  startedAt: number;
}

interface LoopingLayer {
  key: string;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  targetWeight: number;
}

const STORAGE_KEY = 'deadaim_audio_settings';
const MAX_CONCURRENT_VOICES = 12;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  // Bus Architecture: [sfxGain, musicGain, voiceGain] -> masterGain -> compressor -> destination
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;

  // Decoded AudioBuffer Cache (decode once, reuse everywhere)
  private bufferCache: Map<string, AudioBuffer> = new Map();
  private loadingPromises: Map<string, Promise<AudioBuffer | null>> = new Map();
  private missingWarned: Set<string> = new Set();

  // Active 3D Zombie Voices (capped at MAX_CONCURRENT_VOICES = 12)
  private activeVoices: ActiveVoice[] = [];
  private zombieNextGroanAt: Map<string, number> = new Map();
  private zombieLastState: Map<string, string> = new Map();

  // Dynamic Music & Ambience Loops
  private activeLoops: Map<string, LoopingLayer> = new Map();
  private fallbackMusicInterval: any = null;
  private musicNoteStep = 0;
  private musicDuckUntil = 0;

  // User Volume & Mode Settings
  private settings: StoredAudioSettings = {
    masterVolume: 0.85,
    musicVolume: 0.55,
    sfxVolume: 0.9,
    voiceVolume: 0.85,
    muted: false,
    scareLevel: 'medium',
    phoneHitSound: true,
  };

  private soundEnabled = true;
  private musicEnabled = true;
  private isKidsMode = false;
  private currentTheme: ThemeId = 'classic';
  private currentIntensity: 'calm' | 'tense' | 'intense' = 'calm';
  private lowHpAlertPlayed = false;
  private debugCategoryIndex = 0;

  constructor() {
    this.loadSavedSettings();
  }

  private loadSavedSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.settings = { ...this.settings, ...parsed };
      }
    } catch {
      // ignore localStorage errors
    }
  }

  public saveSettings(partial: Partial<StoredAudioSettings>) {
    this.settings = { ...this.settings, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
    this.applyBusVolumes();
  }

  public getAudioSettings(): StoredAudioSettings {
    return { ...this.settings };
  }

  public isAudioUnlocked(): boolean {
    return this.unlocked && this.ctx !== null && this.ctx.state === 'running';
  }

  private initCtx() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();

    // Master Limiter / Compressor to prevent clipping when many sounds play simultaneously
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-8, this.ctx.currentTime);
    this.compressor.knee.setValueAtTime(6, this.ctx.currentTime);
    this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);
    this.compressor.connect(this.ctx.destination);

    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.compressor);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.masterGain);

    this.voiceGain = this.ctx.createGain();
    this.voiceGain.connect(this.masterGain);

    // Position 3D AudioListener at the TV camera position (0, 2.4, 5.0) looking down -Z
    const listener = this.ctx.listener;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(0, this.ctx.currentTime);
      listener.positionY.setValueAtTime(2.4, this.ctx.currentTime);
      listener.positionZ.setValueAtTime(5.0, this.ctx.currentTime);
      listener.forwardX.setValueAtTime(0, this.ctx.currentTime);
      listener.forwardY.setValueAtTime(-0.05, this.ctx.currentTime);
      listener.forwardZ.setValueAtTime(-1, this.ctx.currentTime);
      listener.upX.setValueAtTime(0, this.ctx.currentTime);
      listener.upY.setValueAtTime(1, this.ctx.currentTime);
      listener.upZ.setValueAtTime(0, this.ctx.currentTime);
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(0, 2.4, 5.0);
      listener.setOrientation(0, -0.05, -1, 0, 1, 0);
    }

    this.applyBusVolumes();
    this.preloadManifestBuffers();
  }

  private applyBusVolumes() {
    if (!this.ctx || !this.masterGain || !this.musicGain || !this.sfxGain || !this.voiceGain) {
      return;
    }
    const t = this.ctx.currentTime;
    const isMuted = this.settings.muted || !this.soundEnabled;

    this.masterGain.gain.setTargetAtTime(
      isMuted ? 0.0001 : Math.max(0.0001, this.settings.masterVolume),
      t,
      0.04
    );

    const duckFactor = Date.now() < this.musicDuckUntil ? 0.22 : 1.0;
    const effectiveMusic = this.musicEnabled ? this.settings.musicVolume * duckFactor : 0.0001;
    this.musicGain.gain.setTargetAtTime(Math.max(0.0001, effectiveMusic), t, 0.08);
    this.sfxGain.gain.setTargetAtTime(Math.max(0.0001, this.settings.sfxVolume), t, 0.04);
    this.voiceGain.gain.setTargetAtTime(Math.max(0.0001, this.settings.voiceVolume), t, 0.04);
  }

  public toggleMute(): boolean {
    const next = !this.settings.muted;
    this.saveSettings({ muted: next });
    return next;
  }

  public isMuted(): boolean {
    return this.settings.muted;
  }

  // Unlock AudioContext from user gesture on the TV Lobby screen
  public async unlockAudio(): Promise<boolean> {
    this.initCtx();
    if (!this.ctx) return false;
    try {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this.unlocked = true;
      this.startBackgroundMusic();
      return true;
    } catch {
      return false;
    }
  }

  public resume() {
    this.unlockAudio();
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    this.applyBusVolumes();
  }

  public setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    this.applyBusVolumes();
    if (!enabled) {
      this.stopBackgroundMusic();
    } else if (this.unlocked) {
      this.startBackgroundMusic();
    }
  }

  public setKidsMode(isKids: boolean) {
    if (this.isKidsMode === isKids) return;
    this.isKidsMode = isKids;
    this.updateLoopWeights(1, 0, 100, 100);
  }

  public setTheme(theme: ThemeId) {
    this.currentTheme = theme;
  }

  public setScareLevel(level: ScareLevel) {
    this.saveSettings({ scareLevel: level });
  }

  // Duck music briefly during Boss Entrance Roar or Stingers
  public duckMusic(durationSec = 2.0) {
    this.musicDuckUntil = Date.now() + durationSec * 1000;
    this.applyBusVolumes();
    setTimeout(() => {
      this.applyBusVolumes();
    }, durationSec * 1000 + 50);
  }

  // Decode and cache audio buffer from /public/audio/<category>/
  private async loadBufferOnce(url: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(url)) {
      return this.bufferCache.get(url)!;
    }
    if (this.loadingPromises.has(url)) {
      return this.loadingPromises.get(url)!;
    }

    const promise = (async () => {
      try {
        if (!this.ctx) return null;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(arrayBuf);
        this.bufferCache.set(url, decoded);
        return decoded;
      } catch (err) {
        if (!this.missingWarned.has(url)) {
          this.missingWarned.add(url);
          console.warn(
            `[AudioManager] Missing or undecodable audio file "${url}". Using procedural Web Audio fallback.`,
            err
          );
        }
        return null;
      }
    })();

    this.loadingPromises.set(url, promise);
    return promise;
  }

  private preloadManifestBuffers() {
    const cats = audioManifest.categories as Record<string, any>;
    for (const catKey of Object.keys(cats)) {
      const group = cats[catKey];
      for (const itemKey of Object.keys(group)) {
        const entry = group[itemKey];
        if (Array.isArray(entry.files)) {
          entry.files.forEach((f: string) => this.loadBufferOnce(f));
        } else if (typeof entry === 'object') {
          for (const subKey of Object.keys(entry)) {
            const subEntry = entry[subKey];
            if (Array.isArray(subEntry?.files)) {
              subEntry.files.forEach((f: string) => this.loadBufferOnce(f));
            }
          }
        }
      }
    }
  }

  private getRandomPitch(pitchRange?: number[]): number {
    if (!pitchRange || pitchRange.length < 2) return 1.0;
    const [min, max] = pitchRange;
    return min + Math.random() * (max - min);
  }

  // Play a non-spatial 2D sound entry from shared/audio.json with fallback
  private async playManifestSound(
    entry: { files: string[]; volume: number; pitchRange?: number[]; category?: string } | undefined,
    fallbackFn: () => void,
    pitchMod = 1.0
  ) {
    if (!this.soundEnabled || this.settings.muted) return;
    this.initCtx();
    if (!this.ctx || !this.sfxGain || !this.voiceGain || !this.musicGain) return;

    if (!entry || !entry.files || entry.files.length === 0) {
      fallbackFn();
      return;
    }

    const fileUrl = entry.files[Math.floor(Math.random() * entry.files.length)];
    const buf = this.bufferCache.get(fileUrl) || (await this.loadBufferOnce(fileUrl));
    if (!buf || !this.ctx) {
      fallbackFn();
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = this.getRandomPitch(entry.pitchRange) * pitchMod;

    const gain = this.ctx.createGain();
    gain.gain.value = entry.volume ?? 0.8;

    const targetBus =
      entry.category === 'voice'
        ? this.voiceGain
        : entry.category === 'music'
        ? this.musicGain
        : this.sfxGain;

    source.connect(gain);
    gain.connect(targetBus);
    source.start(0);
  }

  // ============================================================================
  // 1. WEAPON & COMBAT SFX
  // ============================================================================

  public playGunshot() {
    const entry = this.isKidsMode
      ? audioManifest.categories.weapons.shot_kids
      : audioManifest.categories.weapons.shot;
    this.playManifestSound(entry, () => this.synthFallbackGunshot());
  }

  public playEmptyClick() {
    const entry = audioManifest.categories.weapons.empty_click;
    this.playManifestSound(entry, () => this.synthFallbackEmptyClick());
  }

  public playReload() {
    const entry = audioManifest.categories.weapons.reload;
    this.playManifestSound(entry, () => this.synthFallbackReload());
  }

  public playHit(headshot = false) {
    const entry = headshot
      ? audioManifest.categories.weapons.headshot
      : this.isKidsMode
      ? audioManifest.categories.weapons.body_hit_kids
      : audioManifest.categories.weapons.body_hit;
    this.playManifestSound(entry, () => this.synthFallbackHit(headshot));
  }

  public playBarricadeHit() {
    const entry = audioManifest.categories.weapons.barricade_hit;
    this.playManifestSound(entry, () => this.synthFallbackBarricadeHit());
  }

  public playPowerup() {
    const entry = audioManifest.categories.weapons.powerup;
    this.playManifestSound(entry, () => this.synthFallbackPowerup());
  }

  // ============================================================================
  // 2. 3D SPATIAL HRTF ZOMBIE VOICES + 12-VOICE PRIORITY LIMITER
  // ============================================================================

  private cleanupFinishedVoices() {
    const now = performance.now();
    this.activeVoices = this.activeVoices.filter((v) => now - v.startedAt < 1400);
  }

  public async playZombieVoice3D(
    zombieId: string,
    type: ZombieType,
    voiceAction: 'idle' | 'aggro' | 'attack' | 'hit' | 'death',
    pos: { x: number; y: number; z: number }
  ) {
    if (!this.soundEnabled || this.settings.muted) return;
    this.initCtx();
    if (!this.ctx || !this.voiceGain) return;

    this.cleanupFinishedVoices();

    // Priority: Boss (+1000) + proximity to barricade/camera (30 + z)
    const priority = (type === 'boss' ? 1000 : type === 'tank' ? 100 : 0) + (30 + pos.z);

    if (this.activeVoices.length >= MAX_CONCURRENT_VOICES) {
      // Find lowest priority active voice
      let minIdx = 0;
      for (let i = 1; i < this.activeVoices.length; i++) {
        if (this.activeVoices[i].priority < this.activeVoices[minIdx].priority) {
          minIdx = i;
        }
      }
      if (this.activeVoices[minIdx].priority >= priority) {
        return; // Drop lower-priority voice
      }
      // Preempt lowest priority voice
      try {
        this.activeVoices[minIdx].source.stop();
      } catch {
        // ignore
      }
      this.activeVoices.splice(minIdx, 1);
    }

    // Select voice set based on Kids Mode and Theme voiceSet from themes.json
    const themeDef = (themesData.themes as any)[this.currentTheme] || themesData.themes.classic;
    const useKidsVoices = this.isKidsMode || themeDef.voiceSet === 'cartoon';
    const isRobotVoice = themeDef.voiceSet === 'robot';

    const zombieGroup = useKidsVoices
      ? (audioManifest.categories.zombies as any).kids
      : (audioManifest.categories.zombies as any)[type] ||
        audioManifest.categories.zombies.normal;

    const entry = zombieGroup?.[voiceAction];
    if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) {
      this.synthFallbackZombieGroan3D(type, pos);
      return;
    }

    const fileUrl = entry.files[Math.floor(Math.random() * entry.files.length)];
    const buf = this.bufferCache.get(fileUrl) || (await this.loadBufferOnce(fileUrl));
    if (!buf || !this.ctx || !this.voiceGain) {
      this.synthFallbackZombieGroan3D(type, pos);
      return;
    }

    // Create 3D HRTF PannerNode positioned at the zombie's 3D coordinates
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4.0;
    panner.maxDistance = 42.0;
    panner.rolloffFactor = 1.15;

    const t = this.ctx.currentTime;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(pos.x, t);
      panner.positionY.setValueAtTime(pos.y + 1.5, t);
      panner.positionZ.setValueAtTime(pos.z, t);
    } else if (typeof panner.setPosition === 'function') {
      panner.setPosition(pos.x, pos.y + 1.5, pos.z);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buf;

    // Apply random +/- 10% pitch variation (plus robot/scare pitch shift)
    const scarePitch =
      this.settings.scareLevel === 'high' && !useKidsVoices
        ? 0.92
        : this.settings.scareLevel === 'low'
        ? 1.06
        : 1.0;
    const robotPitch = isRobotVoice ? 1.14 : 1.0;
    source.playbackRate.value = this.getRandomPitch(entry.pitchRange) * scarePitch * robotPitch;

    const scareGain =
      this.settings.scareLevel === 'low'
        ? 0.72
        : this.settings.scareLevel === 'high'
        ? 1.15
        : 1.0;
    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(1.0, (entry.volume ?? 0.75) * scareGain);

    source.connect(panner);
    panner.connect(gain);
    gain.connect(this.voiceGain);

    const voiceRecord: ActiveVoice = {
      id: `v_${Date.now()}_${Math.random()}`,
      zombieId,
      priority,
      source,
      gain,
      startedAt: performance.now(),
    };
    this.activeVoices.push(voiceRecord);

    source.onended = () => {
      this.activeVoices = this.activeVoices.filter((v) => v.id !== voiceRecord.id);
    };

    source.start(0);
  }

  public playBossEntranceRoar(pos = { x: 0, y: 2, z: -18 }) {
    this.duckMusic(2.2);
    this.playStinger('boss_arrival');
    if (this.isKidsMode) {
      this.playZombieVoice3D('boss_roar', 'boss', 'aggro', pos);
      return;
    }
    const roarEntry = audioManifest.categories.zombies.boss.entrance_roar;
    this.playManifestSound(roarEntry, () => this.synthFallbackZombieGroan3D('boss', pos));
  }

  // Update per-zombie ambient groans, aggro growls, and attack snarls with random delays
  public updateZombieVoices(zombies: ZombieState[]) {
    if (!this.soundEnabled || this.settings.muted || !this.unlocked) return;
    const now = performance.now();
    const activeIds = new Set<string>();

    // Sort so Boss and closest zombies get evaluated first
    const sorted = [...zombies].sort((a, b) => {
      if (a.type === 'boss' && b.type !== 'boss') return -1;
      if (b.type === 'boss' && a.type !== 'boss') return 1;
      return b.z - a.z;
    });

    for (const z of sorted) {
      activeIds.add(z.id);
      const prevState = this.zombieLastState.get(z.id);

      if (!prevState) {
        this.zombieLastState.set(z.id, z.state);
        // Stagger initial idle groan by 1.2s - 5.5s
        this.zombieNextGroanAt.set(z.id, now + 1200 + Math.random() * 4300);
        if (Math.random() < 0.35) {
          this.playZombieVoice3D(z.id, z.type, 'aggro', { x: z.x, y: z.y, z: z.z });
        }
        continue;
      }

      if (prevState !== z.state) {
        this.zombieLastState.set(z.id, z.state);
        if (z.state === 'dying') {
          this.playZombieVoice3D(z.id, z.type, 'death', { x: z.x, y: z.y, z: z.z });
          continue;
        } else if (z.state === 'attacking') {
          this.playZombieVoice3D(z.id, z.type, 'attack', { x: z.x, y: z.y, z: z.z });
          this.zombieNextGroanAt.set(z.id, now + 1400 + Math.random() * 1200);
          continue;
        }
      }

      const nextAt = this.zombieNextGroanAt.get(z.id) || 0;
      if (now >= nextAt && !z.isFrozen && z.state !== 'dying') {
        const action = z.state === 'attacking' ? 'attack' : 'idle';
        this.playZombieVoice3D(z.id, z.type, action, { x: z.x, y: z.y, z: z.z });
        const delayMs =
          z.state === 'attacking'
            ? 1500 + Math.random() * 1400
            : 3200 + Math.random() * 4500;
        this.zombieNextGroanAt.set(z.id, now + delayMs);
      }
    }

    for (const id of this.zombieLastState.keys()) {
      if (!activeIds.has(id)) {
        this.zombieLastState.delete(id);
        this.zombieNextGroanAt.delete(id);
      }
    }
  }

  // ============================================================================
  // 3. DYNAMIC HORROR MUSIC, AMBIENCE BED, HEARTBEAT & STINGERS
  // ============================================================================

  private async ensureLoopLayer(
    key: string,
    entry: { files: string[]; volume: number }
  ): Promise<LoopingLayer | null> {
    if (!this.ctx || !this.musicGain) return null;
    if (this.activeLoops.has(key)) {
      return this.activeLoops.get(key)!;
    }

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.musicGain);

    const layer: LoopingLayer = {
      key,
      source: null,
      gain,
      targetWeight: 0,
    };
    this.activeLoops.set(key, layer);

    const fileUrl = entry.files[0];
    const buf = this.bufferCache.get(fileUrl) || (await this.loadBufferOnce(fileUrl));
    if (buf && this.ctx) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start(0);
      layer.source = src;
    }

    return layer;
  }

  public async startBackgroundMusic() {
    if (!this.musicEnabled) return;
    this.initCtx();
    if (!this.ctx || !this.musicGain) return;

    await Promise.all([
      this.ensureLoopLayer('horror_bed', audioManifest.categories.ambience.horror_bed),
      this.ensureLoopLayer('kids_bed', audioManifest.categories.ambience.kids_bed),
      this.ensureLoopLayer('calm', audioManifest.categories.music.calm),
      this.ensureLoopLayer('tense', audioManifest.categories.music.tense),
      this.ensureLoopLayer('intense', audioManifest.categories.music.intense),
      this.ensureLoopLayer('heartbeat', audioManifest.categories.music.heartbeat),
      this.ensureLoopLayer('kids_loop', audioManifest.categories.music.kids_loop),
    ]);

    this.updateLoopWeights(1, 0, 100, 100);
  }

  // Dynamically crossfade music layers based on wave, close zombies, and barricade HP
  public updateDynamicMusicState(
    wave: number,
    zombies: ZombieState[],
    barricadeHp: number,
    maxBarricadeHp: number
  ) {
    if (!this.ctx || !this.musicEnabled) return;

    const closeZombies = zombies.filter(
      (z) => z.state !== 'dying' && z.z > -9.0
    ).length;
    const hasBoss = zombies.some((z) => z.type === 'boss' && z.state !== 'dying');

    this.updateLoopWeights(wave, closeZombies + (hasBoss ? 4 : 0), barricadeHp, maxBarricadeHp);

    // Trigger announcer low barricade warning once when dropping below 30% HP
    const hpPct = maxBarricadeHp > 0 ? (barricadeHp / maxBarricadeHp) * 100 : 100;
    if (hpPct > 0 && hpPct < 30 && !this.lowHpAlertPlayed) {
      this.lowHpAlertPlayed = true;
      this.playAnnouncer('barricade_low');
    } else if (hpPct >= 35) {
      this.lowHpAlertPlayed = false;
    }
  }

  private updateLoopWeights(
    wave: number,
    closeThreatCount: number,
    barricadeHp: number,
    maxBarricadeHp: number
  ) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const hpRatio = maxBarricadeHp > 0 ? barricadeHp / maxBarricadeHp : 1.0;

    // Determine intensity level ('calm' | 'tense' | 'intense')
    const scareBias =
      this.settings.scareLevel === 'high' ? 1 : this.settings.scareLevel === 'low' ? -1 : 0;
    const threatScore =
      (wave >= 3 ? 1 : 0) +
      (closeThreatCount >= 2 ? 1 : 0) +
      (closeThreatCount >= 4 || hpRatio < 0.45 ? 2 : 0) +
      scareBias;

    if (threatScore >= 3) {
      this.currentIntensity = 'intense';
    } else if (threatScore >= 1) {
      this.currentIntensity = 'tense';
    } else {
      this.currentIntensity = 'calm';
    }

    const isKids = this.isKidsMode;
    const lowHpHeartbeat = !isKids && hpRatio > 0 && hpRatio < 0.3;

    const weights: Record<string, number> = {
      horror_bed: isKids ? 0.0001 : 0.38,
      kids_bed: isKids ? 0.28 : 0.0001,
      calm: !isKids && this.currentIntensity === 'calm' ? 0.48 : 0.0001,
      tense: !isKids && this.currentIntensity === 'tense' ? 0.56 : 0.0001,
      intense: !isKids && this.currentIntensity === 'intense' ? 0.68 : 0.0001,
      heartbeat: lowHpHeartbeat ? 0.82 * (1 - hpRatio / 0.3 + 0.3) : 0.0001,
      kids_loop: isKids ? 0.48 : 0.0001,
    };

    for (const [key, layer] of this.activeLoops.entries()) {
      const target = Math.max(0.0001, weights[key] ?? 0.0001);
      layer.targetWeight = target;
      layer.gain.gain.setTargetAtTime(target, t, 0.35);
    }
  }

  public stopBackgroundMusic() {
    if (this.fallbackMusicInterval) {
      clearInterval(this.fallbackMusicInterval);
      this.fallbackMusicInterval = null;
    }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const layer of this.activeLoops.values()) {
      layer.gain.gain.setTargetAtTime(0.0001, t, 0.15);
    }
  }

  public playStinger(
    type: 'wave_start' | 'wave_cleared' | 'boss_arrival' | 'victory' | 'defeat'
  ) {
    const entry = (audioManifest.categories.stingers as any)[type];
    this.playManifestSound(entry, () => this.synthFallbackPowerup());
  }

  // ============================================================================
  // 4. ANNOUNCER LINES (Audio File First; SpeechSynthesis ONLY if File Missing)
  // ============================================================================

  public async playAnnouncer(
    line: 'wave_start' | 'boss_incoming' | 'barricade_low' | 'victory' | 'defeat'
  ) {
    if (!this.soundEnabled || this.settings.muted) return;
    this.initCtx();
    if (!this.ctx || !this.voiceGain) return;

    const entry = (audioManifest.categories.announcer as any)[line];
    if (entry && Array.isArray(entry.files) && entry.files.length > 0) {
      const fileUrl = entry.files[0];
      const buf = this.bufferCache.get(fileUrl) || (await this.loadBufferOnce(fileUrl));
      if (buf && this.ctx) {
        const source = this.ctx.createBufferSource();
        source.buffer = buf;
        source.playbackRate.value = this.getRandomPitch(entry.pitchRange);
        const gain = this.ctx.createGain();
        gain.gain.value = entry.volume ?? 0.95;
        source.connect(gain);
        gain.connect(this.voiceGain);
        source.start(0);
        return;
      }
    }

    // Fallback ONLY if announcer audio file is missing
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && entry?.fallbackText) {
      try {
        const utter = new SpeechSynthesisUtterance(entry.fallbackText);
        utter.rate = 0.95;
        utter.pitch = this.isKidsMode ? 1.2 : 0.75;
        utter.volume = Math.min(1, this.settings.masterVolume * this.settings.voiceVolume);
        window.speechSynthesis.speak(utter);
      } catch {
        // ignore speech synthesis errors
      }
    }
  }

  // ============================================================================
  // 5. DEBUG KEY (K) SOUND CATEGORY PREVIEWER
  // ============================================================================

  public triggerDebugSoundPreview(): { category: string; description: string } {
    this.unlockAudio();
    const previews = [
      {
        category: '1/6 WEAPONS',
        description: 'Gunshot + Headshot Ding/Crunch + Mechanical Reload',
        run: () => {
          this.playGunshot();
          setTimeout(() => this.playHit(true), 180);
          setTimeout(() => this.playReload(), 420);
        },
      },
      {
        category: '2/6 ZOMBIE VOICES (3D HRTF)',
        description: 'Spatial Left/Right Zombie Growl & Attack Snarl (+/-10% Pitch)',
        run: () => {
          this.playZombieVoice3D('dbg_1', 'normal', 'aggro', { x: -6, y: 1, z: -6 });
          setTimeout(
            () => this.playZombieVoice3D('dbg_2', 'tank', 'attack', { x: 6, y: 1, z: -5 }),
            320
          );
        },
      },
      {
        category: '3/6 BOSS ENTRANCE ROAR',
        description: 'Boss Roar + Music Duck + Stinger',
        run: () => {
          this.playBossEntranceRoar({ x: 0, y: 2, z: -8 });
        },
      },
      {
        category: '4/6 DYNAMIC MUSIC & HEARTBEAT',
        description: 'Crossfading Intense Layer + Low-HP (<30%) Heartbeat Pulse',
        run: () => {
          this.updateLoopWeights(5, 6, 20, 100);
        },
      },
      {
        category: '5/6 HORROR STINGERS',
        description: 'Wave Start & Wave Cleared Stingers',
        run: () => {
          this.playStinger('wave_start');
        },
      },
      {
        category: '6/6 ANNOUNCER VOICE',
        description: 'Announcer Audio Callout ("Boss Incoming")',
        run: () => {
          this.playAnnouncer('boss_incoming');
        },
      },
    ];

    const item = previews[this.debugCategoryIndex % previews.length];
    this.debugCategoryIndex++;
    item.run();
    return { category: item.category, description: item.description };
  }

  // ============================================================================
  // 6. PROCEDURAL WEB AUDIO FALLBACK SYNTHESIZERS (Never crashes on missing file)
  // ============================================================================

  private synthFallbackGunshot() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = this.isKidsMode ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(this.isKidsMode ? 880 : 160, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  private synthFallbackEmptyClick() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(980, t);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.04);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  private synthFallbackReload() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    [0, 0.18, 0.36].forEach((offset, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(420 + idx * 240, t + offset);
      gain.gain.setValueAtTime(0.25, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.01, t + offset + 0.06);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t + offset);
      osc.stop(t + offset + 0.07);
    });
  }

  private synthFallbackHit(headshot: boolean) {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = headshot ? 'triangle' : 'sawtooth';
    osc.frequency.setValueAtTime(headshot ? 1620 : 180, t);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2240 : 60, t + 0.12);
    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  private synthFallbackBarricadeHit() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(85, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.28);
    gain.gain.setValueAtTime(0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.31);
  }

  private synthFallbackPowerup() {
    if (!this.ctx || !this.sfxGain) return;
    const notes = [440, 554, 659, 880];
    const t = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.06);
      gain.gain.setValueAtTime(0.3, t + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.06 + 0.12);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t + idx * 0.06);
      osc.stop(t + idx * 0.06 + 0.13);
    });
  }

  private synthFallbackZombieGroan3D(
    type: ZombieType,
    pos: { x: number; y: number; z: number }
  ) {
    if (!this.ctx || !this.voiceGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    if (panner.positionX) {
      panner.positionX.setValueAtTime(pos.x, t);
      panner.positionY.setValueAtTime(pos.y + 1.5, t);
      panner.positionZ.setValueAtTime(pos.z, t);
    }

    const baseFreq = type === 'boss' ? 52 : type === 'tank' ? 72 : type === 'fast' ? 210 : 108;
    osc.type = this.isKidsMode ? 'triangle' : 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq * (0.9 + Math.random() * 0.2), t);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.78, t + 0.36);

    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.38);

    osc.connect(panner);
    panner.connect(gain);
    gain.connect(this.voiceGain);
    osc.start(t);
    osc.stop(t + 0.4);
  }
}
