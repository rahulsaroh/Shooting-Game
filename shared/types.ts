/**
 * Shared Type Definitions for DeadAim: Motion Gun Zombie Shooter (Arcade Edition)
 */

export type GamePhase =
  | 'LOBBY'
  | 'TUTORIAL'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'WAVE_CLEARED'
  | 'BONUS_ROUND'
  | 'GAME_OVER'
  | 'VICTORY';

export type ZombieType = 'normal' | 'fast' | 'tank' | 'boss';

export type WeaponType = 'pistol' | 'shotgun' | 'machine_gun' | 'grenade_launcher';

export type PowerUpType = 'ammo' | 'health' | 'freeze' | 'double_damage' | 'weapon_crate';

export type ThemeId = 'classic' | 'cartoon' | 'robot';

export type GameDifficulty = 'easy' | 'normal' | 'hard';

export type ContentRating = 'adult' | 'kids';

export type ScareLevel = 'low' | 'medium' | 'high';

export type PostProcessingQuality = 'high' | 'low';

export type HapticPatternType =
  | 'shoot'
  | 'shoot_pistol'
  | 'shoot_shotgun'
  | 'shoot_machine_gun'
  | 'shoot_grenade'
  | 'hit'
  | 'damage'
  | 'reload'
  | 'empty'
  | 'coop_bonus';

export interface ZombieHitboxConfig {
  headSphere: {
    offsetY: number;
    radius: number;
  };
  bodyCapsule: {
    bottomY: number;
    topY: number;
    radius: number;
  };
}

export interface WeaponDefinition {
  id: WeaponType;
  name: string;
  shortName: string;
  damage: number;
  headshotMultiplier: number;
  fireRateMs: number;
  autoFireIntervalMs: number;
  spread: number;
  pellets: number;
  splashRadius: number;
  maxAmmo: number;
  infiniteAmmo: boolean;
  reloadTimeMs: number;
  shakeIntensity: number;
  hapticPattern: HapticPatternType;
  soundKey: string;
  color: string;
}

export interface StageDefinition {
  id: number;
  name: string;
  subtitle: string;
  theme: ThemeId;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  ambientColor: string;
  directionalLightColor: string;
  accentLightColor: string;
  flickerIntensity: number;
  bossName: string;
  bossWeakPointOffsetY: number;
  bossWeakPointRadius: number;
}

export interface RewardItem {
  id: string;
  name: string;
  category: 'weapon_skin' | 'crosshair' | 'theme';
  costTickets: number;
  previewColor: string;
  description: string;
}

export interface HighScoreEntry {
  initials: string;
  name: string;
  score: number;
  stage: number;
  wave: number;
  date: string;
}

export interface PlayerStats {
  score: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  headshots: number;
  civiliansHit?: number;
  revives?: number;
  coopBonuses?: number;
}

export interface PlayerInfo {
  id: string;
  reconnectToken: string;
  name: string;
  color: string;
  slot: number;
  isConnected: boolean;
  isBot?: boolean;
  weapon: WeaponType;
  ammo: number;
  maxAmmo: number;
  isReloading: boolean;
  reloadEndTime: number;
  autoFire?: boolean;
  autoReload?: boolean;
  unlimitedAmmo?: boolean;
  lastShotTime?: number;
  isTargetLocked?: boolean;
  combo: number;
  multiplier: number;
  maxCombo: number;
  hp: number;
  maxHp: number;
  isDowned: boolean;
  downedRemainingSec: number;
  tickets: number;
  unlockedRewards: string[];
  equippedSkin: string;
  equippedCrosshair: string;
  tutorialReady?: boolean;
  crosshair: {
    x: number; // 0 to 1 normalized screen coordinate
    y: number; // 0 to 1 normalized screen coordinate
    lastUpdate: number;
  };
  stats: PlayerStats;
}

export type ZombieSpawnOrigin =
  | 'street_front'
  | 'left_alley'
  | 'right_alley'
  | 'tree_leap'
  | 'rooftop_drop';

export interface ZombieState {
  id: string;
  type: ZombieType;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  radius: number;
  isFrozen: boolean;
  state: 'walking' | 'attacking' | 'dying';
  deathProgress?: number;
  deathVariant?: number;
  staggerTimer?: number;
  theme: ThemeId;
  spawnOrigin?: ZombieSpawnOrigin;
  targetX?: number;
  vy?: number;
  strafePhase?: number;
  isCivilian?: boolean;
  isBonusTarget?: boolean;
  weakPoint?: {
    offsetY: number;
    radius: number;
    active: boolean;
  };
  lastHitBy?: {
    playerId: string;
    time: number;
  }[];
}

export interface PowerUpState {
  id: string;
  type: PowerUpType;
  weaponGrant?: WeaponType;
  x: number;
  y: number;
  z: number;
  createdAt: number;
}

export interface GameSettings {
  mode: ContentRating;
  scareLevel: ScareLevel;
  difficulty: GameDifficulty;
  theme: ThemeId;
  maxWaves: number;
  friendlyFire: boolean;
  soundEnabled: boolean;
  musicEnabled: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  phoneHitSound: boolean;
  autoFire: boolean;
  autoReload: boolean;
  unlimitedAmmo: boolean;
  postProcessingQuality: PostProcessingQuality;
}

export interface ActiveEffects {
  freezeRemainingMs: number;
  doubleDamageRemainingMs: number;
}

export interface GameWorldState {
  phase: GamePhase;
  countdownSeconds: number;
  currentWave: number;
  stageIndex: number;
  stageName: string;
  barricadeHp: number;
  maxBarricadeHp: number;
  zombies: ZombieState[];
  powerups: PowerUpState[];
  players: PlayerInfo[];
  settings: GameSettings;
  effects: ActiveEffects;
  intermissionCountdown: number;
  serverTickRate: number;
  slowMoRemainingMs: number;
  highScores: HighScoreEntry[];
}

// WebSocket Message Protocol
export type ClientMessage =
  | { type: 'phone_join'; name: string; color?: string; reconnectToken?: string }
  | { type: 'aim'; x: number; y: number; pitch?: number; yaw?: number; roll?: number }
  | { type: 'shoot'; timestamp?: number }
  | { type: 'reload' }
  | { type: 'recenter' }
  | { type: 'switch_weapon'; weapon: WeaponType }
  | { type: 'submit_highscore'; initials: string }
  | { type: 'unlock_reward'; rewardId: string }
  | { type: 'equip_reward'; rewardId: string }
  | { type: 'skip_tutorial' }
  | {
      type: 'update_player_options';
      autoFire?: boolean;
      autoReload?: boolean;
      unlimitedAmmo?: boolean;
    }
  | { type: 'start_game' }
  | { type: 'restart_game' }
  | { type: 'update_settings'; settings: Partial<GameSettings> }
  | { type: 'spawn_bots'; count: number }
  | { type: 'remove_bots' }
  | { type: 'ping'; time: number };

export type ServerMessage =
  | { type: 'phone_joined'; player: PlayerInfo; reconnectToken: string }
  | { type: 'lobby_update'; players: PlayerInfo[]; settings: GameSettings; phase: GamePhase }
  | { type: 'game_tick'; world: GameWorldState }
  | {
      type: 'haptic';
      pattern: HapticPatternType;
      headshot?: boolean;
    }
  | {
      type: 'hit_event';
      playerId: string;
      zombieId: string;
      zombieType?: ZombieType;
      weapon?: WeaponType;
      headshot: boolean;
      weakPointHit?: boolean;
      damage: number;
      scoreAwarded?: number;
      combo?: number;
      multiplier?: number;
      killed: boolean;
      isBossKill?: boolean;
      position: { x: number; y: number; z: number };
    }
  | {
      type: 'coop_combo';
      playerIds: string[];
      playerNames: string[];
      bonusScore: number;
      position: { x: number; y: number; z: number };
    }
  | {
      type: 'civilian_hit';
      playerId: string;
      playerName: string;
      penalty: number;
      position: { x: number; y: number; z: number };
    }
  | {
      type: 'player_downed';
      playerId: string;
      playerName: string;
    }
  | {
      type: 'player_revived';
      playerId: string;
      reviverId: string;
      playerName: string;
      reviverName: string;
    }
  | {
      type: 'boss_spawned';
      zombieId: string;
      bossName?: string;
      position: { x: number; y: number; z: number };
    }
  | { type: 'barricade_damaged'; currentHp: number; damage: number }
  | {
      type: 'powerup_collected';
      playerId: string;
      powerupType: PowerUpType;
      weaponGranted?: WeaponType;
    }
  | { type: 'highscores_updated'; highScores: HighScoreEntry[] }
  | { type: 'pong'; time: number }
  | { type: 'error'; message: string };

export interface ServerNetworkInfo {
  localIp: string;
  port: number;
  localUrl: string;
  controllerUrl: string;
  gameUrl: string;
  isHttps: boolean;
}
