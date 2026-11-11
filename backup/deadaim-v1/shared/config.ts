import {
  GameSettings,
  RewardItem,
  StageDefinition,
  WeaponDefinition,
  WeaponType,
  ZombieHitboxConfig,
  ZombieType,
} from './types.ts';

export const PLAYER_COLORS = [
  { name: 'Neon Cyan', hex: '#00f5d4' },
  { name: 'Electric Pink', hex: '#f72585' },
  { name: 'Solar Yellow', hex: '#fee440' },
  { name: 'Toxic Lime', hex: '#70e000' },
  { name: 'Ultra Violet', hex: '#7209b7' },
  { name: 'Blaze Orange', hex: '#ff5400' },
  { name: 'Laser Blue', hex: '#4361ee' },
  { name: 'Ghost White', hex: '#f8f9fa' },
];

export const WEAPON_CONFIG = {
  maxAmmo: 12,
  reloadTimeMs: 1200,
  baseDamage: 25,
  headshotMultiplier: 2.2,
  fireRateLimitMs: 120,
  autoFireIntervalMs: 185,
};

/**
 * Phase C: Config-driven Arcade Weapons
 */
export const WEAPONS: Record<WeaponType, WeaponDefinition> = {
  pistol: {
    id: 'pistol',
    name: '9MM SERVICE PISTOL',
    shortName: 'PISTOL',
    damage: 25,
    headshotMultiplier: 2.2,
    fireRateMs: 130,
    autoFireIntervalMs: 195,
    spread: 0.0,
    pellets: 1,
    splashRadius: 0,
    maxAmmo: 12,
    infiniteAmmo: true, // Always has infinite reserve / reloads
    reloadTimeMs: 1050,
    shakeIntensity: 0.14,
    hapticPattern: 'shoot',
    soundKey: 'shot',
    color: '#00f5d4',
  },
  shotgun: {
    id: 'shotgun',
    name: 'TACTICAL PUMP SHOTGUN',
    shortName: 'SHOTGUN',
    damage: 22, // per pellet (x4 pellets = 88 close damage)
    headshotMultiplier: 1.8,
    fireRateMs: 460,
    autoFireIntervalMs: 520,
    spread: 0.045,
    pellets: 4,
    splashRadius: 1.15,
    maxAmmo: 8,
    infiniteAmmo: false,
    reloadTimeMs: 1400,
    shakeIntensity: 0.38,
    hapticPattern: 'shoot_shotgun',
    soundKey: 'shot',
    color: '#ff5400',
  },
  machine_gun: {
    id: 'machine_gun',
    name: 'PULSE ASSAULT SMG',
    shortName: 'MACHINE GUN',
    damage: 18,
    headshotMultiplier: 2.0,
    fireRateMs: 85,
    autoFireIntervalMs: 105,
    spread: 0.018,
    pellets: 1,
    splashRadius: 0,
    maxAmmo: 36,
    infiniteAmmo: false,
    reloadTimeMs: 1250,
    shakeIntensity: 0.18,
    hapticPattern: 'shoot_machine_gun',
    soundKey: 'shot',
    color: '#fee440',
  },
  grenade_launcher: {
    id: 'grenade_launcher',
    name: 'M79 PLASMA LAUNCHER',
    shortName: 'GRENADE',
    damage: 110,
    headshotMultiplier: 1.5,
    fireRateMs: 750,
    autoFireIntervalMs: 820,
    spread: 0.01,
    pellets: 1,
    splashRadius: 3.8,
    maxAmmo: 5,
    infiniteAmmo: false,
    reloadTimeMs: 1650,
    shakeIntensity: 0.65,
    hapticPattern: 'shoot_grenade',
    soundKey: 'shot',
    color: '#f72585',
  },
};

/**
 * Phase B & D: 3 Distinct Arcade Stages with Boss Weak Points & Dynamic Lighting
 */
export const STAGES: StageDefinition[] = [
  {
    id: 1,
    name: 'STAGE 1: NEON DOWNTOWN',
    subtitle: 'quarantine boulevard',
    theme: 'classic',
    propSet: 'downtown',
    propList: [
      'skyscrapers',
      'neon_billboards',
      'street_trees',
      'police_cruiser',
      'street_lamps',
    ],
    skyColor: '#0c081a',
    fogColor: '#120b29',
    fogDensity: 0.018,
    ambientColor: '#4c3b78',
    directionalLightColor: '#a29bfe',
    accentLightColor: '#00f5d4',
    roadColor: '#141829',
    sidewalkColor: '#2b2d42',
    ambientParticleColor: '#00f5d4',
    musicTrackId: 'tense',
    ambienceTrackId: 'city_wind',
    flickerIntensity: 0.25,
    bossName: 'MUTANT JUGGERNAUT',
    bossWeakPointOffsetY: 2.35,
    bossWeakPointRadius: 0.55,
  },
  {
    id: 2,
    name: 'STAGE 2: BIO-LAB REACTOR',
    subtitle: 'containment sector b-12',
    theme: 'cartoon',
    propSet: 'biolab',
    propList: [
      'containment_tubes',
      'glowing_bio_liquid',
      'biohazard_signs',
      'steam_vents',
      'flickering_hazard_lights',
      'metal_walkways',
      'reactor_core',
    ],
    skyColor: '#041712',
    fogColor: '#06241b',
    fogDensity: 0.021,
    ambientColor: '#1f6f54',
    directionalLightColor: '#52b788',
    accentLightColor: '#70e000',
    roadColor: '#081c17',
    sidewalkColor: '#13332b',
    ambientParticleColor: '#70e000',
    musicTrackId: 'intense',
    ambienceTrackId: 'reactor_hum',
    flickerIntensity: 0.45,
    bossName: 'TOXIC BIO-BEHEMOTH',
    bossWeakPointOffsetY: 2.45,
    bossWeakPointRadius: 0.58,
  },
  {
    id: 3,
    name: 'STAGE 3: CYBER CITADEL ROOFTOP',
    subtitle: 'omega broadcast tower',
    theme: 'robot',
    propSet: 'citadel',
    propList: [
      'cyber_spires',
      'plasma_pylons',
      'holo_banners',
      'laser_barriers',
      'omega_core',
    ],
    skyColor: '#1a0714',
    fogColor: '#24091b',
    fogDensity: 0.016,
    ambientColor: '#6a1b4d',
    directionalLightColor: '#ff758f',
    accentLightColor: '#f72585',
    roadColor: '#1a0b18',
    sidewalkColor: '#2e1029',
    ambientParticleColor: '#f72585',
    musicTrackId: 'intense',
    ambienceTrackId: 'citadel_storm',
    flickerIntensity: 0.35,
    bossName: 'OMEGA MECH OVERLORD',
    bossWeakPointOffsetY: 2.55,
    bossWeakPointRadius: 0.62,
  },
];

/**
 * Phase E: Unlockable Rewards System (Weapon Skins, Crosshair Styles, Zombie Themes)
 */
export const REWARDS_CATALOG: RewardItem[] = [
  {
    id: 'skin_default',
    name: 'Standard Tactical',
    category: 'weapon_skin',
    costTickets: 0,
    previewColor: '#00f5d4',
    description: 'Factory-issue neon frame.',
  },
  {
    id: 'skin_gold',
    name: 'Golden Arcade VIP',
    category: 'weapon_skin',
    costTickets: 15,
    previewColor: '#ffd700',
    description: '24K gold-plated arcade blaster.',
  },
  {
    id: 'skin_cyber_pink',
    name: 'Cyberpunk Overdrive',
    category: 'weapon_skin',
    costTickets: 30,
    previewColor: '#f72585',
    description: 'High-voltage magenta plasma casing.',
  },
  {
    id: 'skin_venom',
    name: 'Bio-Hazard Acid',
    category: 'weapon_skin',
    costTickets: 45,
    previewColor: '#70e000',
    description: 'Glowing radioactive green finish.',
  },
  {
    id: 'crosshair_default',
    name: 'Classic Bullseye',
    category: 'crosshair',
    costTickets: 0,
    previewColor: '#00f5d4',
    description: 'Standard arcade light-gun ring.',
  },
  {
    id: 'crosshair_diamond',
    name: 'Tactical Diamond',
    category: 'crosshair',
    costTickets: 15,
    previewColor: '#fee440',
    description: 'Precision rotating diamond reticle.',
  },
  {
    id: 'crosshair_star',
    name: 'Party Starburst',
    category: 'crosshair',
    costTickets: 25,
    previewColor: '#ff5400',
    description: 'Arcade star reticle with corner brackets.',
  },
  {
    id: 'theme_cartoon',
    name: 'Cartoon Slime Theme',
    category: 'theme',
    costTickets: 20,
    previewColor: '#70e000',
    description: 'Unlocks goofy cartoon zombie models.',
  },
  {
    id: 'theme_robot',
    name: 'Cyber Robot Theme',
    category: 'theme',
    costTickets: 35,
    previewColor: '#4361ee',
    description: 'Unlocks rogue android & mech models.',
  },
];

// Overall 3D scale multiplier so zombies look large across the street and fill the screen up close
export const ZOMBIE_VISUAL_SCALE = 1.85;

/**
 * Authoritative Server & Debug Hitboxes (Head Sphere + Body Capsule) per Zombie Type.
 * Defined in local model space (multiplied by ZOMBIE_VISUAL_SCALE in world space).
 * Keeps server hit detection 100% independent of visual meshes/animations.
 */
export const ZOMBIE_HITBOXES: Record<ZombieType, ZombieHitboxConfig> = {
  normal: {
    headSphere: { offsetY: 1.72, radius: 0.36 },
    bodyCapsule: { bottomY: 0.42, topY: 1.44, radius: 0.46 },
  },
  fast: {
    headSphere: { offsetY: 1.46, radius: 0.33 },
    bodyCapsule: { bottomY: 0.38, topY: 1.22, radius: 0.41 },
  },
  tank: {
    headSphere: { offsetY: 2.3, radius: 0.48 },
    bodyCapsule: { bottomY: 0.52, topY: 1.92, radius: 0.74 },
  },
  boss: {
    headSphere: { offsetY: 3.35, radius: 0.66 },
    bodyCapsule: { bottomY: 0.72, topY: 2.8, radius: 0.98 },
  },
};

export const COMBO_CONFIG = {
  maxMultiplier: 8,
  hitsPerMultiplierTier: 3, // Every 3 consecutive hits increases multiplier (1x -> 2x -> 3x ... -> 8x)
  coopWindowMs: 1500, // Co-op crossfire window when 2+ players hit same zombie
  coopBonusScore: 100,
  civilianPenaltyScore: 150,
  reviveWindowSec: 10,
  playerMaxHp: 100,
};

export const DEFAULT_SETTINGS: GameSettings = {
  mode: 'adult',
  scareLevel: 'medium',
  difficulty: 'normal',
  theme: 'classic',
  maxWaves: 6,
  friendlyFire: false,
  soundEnabled: true,
  musicEnabled: true,
  masterVolume: 0.85,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  voiceVolume: 0.85,
  phoneHitSound: true,
  autoFire: false,
  autoReload: true,
  unlimitedAmmo: false,
  postProcessingQuality: 'high',
};

export const DIFFICULTY_PRESETS = {
  easy: {
    hpMultiplier: 0.75,
    speedMultiplier: 0.8,
    zombieCountMultiplier: 0.7,
    barricadeHp: 150,
  },
  normal: {
    hpMultiplier: 1.0,
    speedMultiplier: 1.0,
    zombieCountMultiplier: 1.0,
    barricadeHp: 100,
  },
  hard: {
    hpMultiplier: 1.35,
    speedMultiplier: 1.25,
    zombieCountMultiplier: 1.35,
    barricadeHp: 80,
  },
};

export const POWERUP_CONFIG = {
  freezeDurationMs: 6000,
  doubleDamageDurationMs: 8000,
  healAmount: 35,
  bonusAmmoRounds: 18,
};
