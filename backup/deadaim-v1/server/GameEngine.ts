import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GamePhase,
  GameWorldState,
  PlayerInfo,
  ZombieState,
  PowerUpState,
  GameSettings,
  ServerMessage,
  ZombieType,
  ZombieSpawnOrigin,
  PowerUpType,
  WeaponType,
  HighScoreEntry,
} from '../shared/types.ts';
import {
  COMBO_CONFIG,
  DEFAULT_SETTINGS,
  DIFFICULTY_PRESETS,
  PLAYER_COLORS,
  POWERUP_CONFIG,
  REWARDS_CATALOG,
  STAGES,
  WEAPON_CONFIG,
  WEAPONS,
  ZOMBIE_HITBOXES,
  ZOMBIE_VISUAL_SCALE,
} from '../shared/config.ts';
import themesData from '../shared/themes.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, 'data');
const HIGHSCORES_FILE = path.join(DATA_DIR, 'highscores.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

interface PlayerProfileData {
  name: string;
  tickets: number;
  unlockedRewards: string[];
  equippedSkin: string;
  equippedCrosshair: string;
}

const DEFAULT_HIGHSCORES: HighScoreEntry[] = [
  { initials: 'ACE', name: 'Agent Ace', score: 18500, stage: 3, wave: 6, date: '2026-11-01' },
  { initials: 'GUN', name: 'LightGunner', score: 14200, stage: 3, wave: 5, date: '2026-11-02' },
  { initials: 'ZOM', name: 'Slayer99', score: 11800, stage: 2, wave: 4, date: '2026-11-03' },
  { initials: 'MAX', name: 'MaxPower', score: 9400, stage: 2, wave: 3, date: '2026-11-04' },
  { initials: 'KID', name: 'PartyStar', score: 7200, stage: 1, wave: 2, date: '2026-11-05' },
];

export class GameEngine {
  private phase: GamePhase = 'LOBBY';
  private countdownSeconds = 3;
  private currentWave = 1;
  private barricadeHp = 100;
  private maxBarricadeHp = 100;
  private zombies: ZombieState[] = [];
  private powerups: PowerUpState[] = [];
  private players: Map<string, PlayerInfo> = new Map(); // key is playerId
  private tokenToPlayerId: Map<string, string> = new Map(); // key is reconnectToken
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private freezeRemainingMs = 0;
  private doubleDamageRemainingMs = 0;
  private slowMoRemainingMs = 0;
  private intermissionCountdown = 0;
  private zombieIdCounter = 1;
  private powerupIdCounter = 1;
  private nextWaveSpawnQueue: { type: ZombieType; delay: number; isCivilian?: boolean; isBonusTarget?: boolean }[] = [];
  private lastTickTime = Date.now();
  private serverTickRate = 30;
  private highScores: HighScoreEntry[] = [];
  private profiles: Record<string, PlayerProfileData> = {};
  private persistToDisk: boolean;
  private broadcastCallback: (msg: ServerMessage) => void;
  private directMessageCallback: (playerId: string, msg: ServerMessage) => void;

  constructor(
    broadcast: (msg: ServerMessage) => void,
    directMessage: (playerId: string, msg: ServerMessage) => void,
    persistToDisk = true
  ) {
    this.broadcastCallback = broadcast;
    this.directMessageCallback = directMessage;
    this.persistToDisk = persistToDisk;
    this.loadPersistentData();
  }

  private loadPersistentData() {
    try {
      if (this.persistToDisk) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (this.persistToDisk && fs.existsSync(HIGHSCORES_FILE)) {
        const raw = fs.readFileSync(HIGHSCORES_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.highScores = parsed;
        } else {
          this.highScores = [...DEFAULT_HIGHSCORES];
        }
      } else {
        this.highScores = [...DEFAULT_HIGHSCORES];
        this.saveHighScores();
      }

      if (this.persistToDisk && fs.existsSync(PROFILES_FILE)) {
        const raw = fs.readFileSync(PROFILES_FILE, 'utf-8');
        this.profiles = JSON.parse(raw) || {};
      }
    } catch {
      this.highScores = [...DEFAULT_HIGHSCORES];
      this.profiles = {};
    }
  }

  private saveHighScores() {
    if (!this.persistToDisk) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(HIGHSCORES_FILE, JSON.stringify(this.highScores, null, 2), 'utf-8');
    } catch {
      // Ignore write errors in restricted environments
    }
  }

  private saveProfiles() {
    if (!this.persistToDisk) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(this.profiles, null, 2), 'utf-8');
    } catch {
      // Ignore write errors
    }
  }

  private getOrCreateProfile(name: string): PlayerProfileData {
    const key = (name || 'Player').trim().toLowerCase();
    if (!this.profiles[key]) {
      this.profiles[key] = {
        name: name || 'Player',
        tickets: 25, // Starter arcade tickets so new players can try unlocking right away
        unlockedRewards: ['skin_default', 'crosshair_default'],
        equippedSkin: 'skin_default',
        equippedCrosshair: 'crosshair_default',
      };
      this.saveProfiles();
    }
    return this.profiles[key];
  }

  private syncPlayerToProfile(player: PlayerInfo) {
    if (player.isBot) return;
    const key = player.name.trim().toLowerCase();
    this.profiles[key] = {
      name: player.name,
      tickets: player.tickets,
      unlockedRewards: player.unlockedRewards,
      equippedSkin: player.equippedSkin,
      equippedCrosshair: player.equippedCrosshair,
    };
    this.saveProfiles();
  }

  public getStageIndexForWave(wave: number): number {
    // 3 stages across waves: Waves 1-2 = Stage 0, Waves 3-4 = Stage 1, Waves 5+ = Stage 2
    const idx = Math.floor(( Math.max(1, wave) - 1) / 2);
    return Math.min(STAGES.length - 1, idx);
  }

  public getCurrentStage() {
    return STAGES[this.getStageIndexForWave(this.currentWave)] || STAGES[0];
  }

  public getSettings(): GameSettings {
    return this.settings;
  }

  public getHighScores(): HighScoreEntry[] {
    return this.highScores;
  }

  public submitHighScore(playerId: string, rawInitials: string): HighScoreEntry[] {
    const player = this.players.get(playerId);
    const cleanInitials =
      (rawInitials || 'AAA')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 3)
        .padEnd(3, 'A');

    const score = player ? player.stats.score : 0;
    const entry: HighScoreEntry = {
      initials: cleanInitials,
      name: player ? player.name : 'Arcade Player',
      score,
      stage: this.getStageIndexForWave(this.currentWave) + 1,
      wave: this.currentWave,
      date: new Date().toISOString().slice(0, 10),
    };

    this.highScores.push(entry);
    this.highScores.sort((a, b) => b.score - a.score);
    this.highScores = this.highScores.slice(0, 10);
    this.saveHighScores();

    this.broadcastCallback({
      type: 'highscores_updated',
      highScores: this.highScores,
    });

    return this.highScores;
  }

  public handleUnlockReward(playerId: string, rewardId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const item = REWARDS_CATALOG.find((r) => r.id === rewardId);
    if (!item) return false;

    if (player.unlockedRewards.includes(rewardId)) {
      return this.handleEquipReward(playerId, rewardId);
    }

    if (player.tickets < item.costTickets) {
      return false;
    }

    player.tickets -= item.costTickets;
    player.unlockedRewards.push(rewardId);
    this.handleEquipReward(playerId, rewardId);
    this.syncPlayerToProfile(player);
    this.broadcastLobbyUpdate();
    return true;
  }

  public handleEquipReward(playerId: string, rewardId: string): boolean {
    const player = this.players.get(playerId);
    if (!player || !player.unlockedRewards.includes(rewardId)) return false;

    const item = REWARDS_CATALOG.find((r) => r.id === rewardId);
    if (!item) return false;

    if (item.category === 'weapon_skin') {
      player.equippedSkin = rewardId;
    } else if (item.category === 'crosshair') {
      player.equippedCrosshair = rewardId;
    } else if (item.category === 'theme') {
      if (rewardId === 'theme_cartoon') this.settings.theme = 'cartoon';
      if (rewardId === 'theme_robot') this.settings.theme = 'robot';
    }

    this.syncPlayerToProfile(player);
    this.broadcastLobbyUpdate();
    return true;
  }

  public handleSwitchWeapon(playerId: string, weapon: WeaponType) {
    const player = this.players.get(playerId);
    if (!player || !WEAPONS[weapon]) return;
    const wDef = WEAPONS[weapon];
    player.weapon = weapon;
    player.maxAmmo = wDef.maxAmmo;
    player.ammo = wDef.maxAmmo;
    player.isReloading = false;
  }

  public updateSettings(newSettings: Partial<GameSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    const diff = DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal;
    this.maxBarricadeHp = diff.barricadeHp;
    if (this.phase === 'LOBBY') {
      this.barricadeHp = this.maxBarricadeHp;
    }

    // Sync global weapon assist toggles to all connected players
    for (const player of this.players.values()) {
      if (newSettings.autoFire !== undefined) player.autoFire = newSettings.autoFire;
      if (newSettings.autoReload !== undefined) player.autoReload = newSettings.autoReload;
      if (newSettings.unlimitedAmmo !== undefined) {
        player.unlimitedAmmo = newSettings.unlimitedAmmo;
        if (newSettings.unlimitedAmmo) {
          player.ammo = player.maxAmmo;
          player.isReloading = false;
        }
      }
    }

    this.broadcastLobbyUpdate();
  }

  public handleUpdatePlayerOptions(
    playerId: string,
    opts: { autoFire?: boolean; autoReload?: boolean; unlimitedAmmo?: boolean }
  ) {
    const player = this.players.get(playerId);
    if (!player) return;

    if (opts.autoFire !== undefined) player.autoFire = opts.autoFire;
    if (opts.autoReload !== undefined) player.autoReload = opts.autoReload;
    if (opts.unlimitedAmmo !== undefined) {
      player.unlimitedAmmo = opts.unlimitedAmmo;
      if (opts.unlimitedAmmo) {
        player.ammo = player.maxAmmo;
        player.isReloading = false;
      }
    }
    this.broadcastLobbyUpdate();
  }

  public getPhase(): GamePhase {
    return this.phase;
  }

  public getPlayers(): PlayerInfo[] {
    return Array.from(this.players.values());
  }

  public getWorldState(): GameWorldState {
    const stage = this.getCurrentStage();
    return {
      phase: this.phase,
      countdownSeconds: Math.ceil(this.countdownSeconds),
      currentWave: this.currentWave,
      stageIndex: this.getStageIndexForWave(this.currentWave),
      stageName: stage.name,
      barricadeHp: Math.max(0, Math.round(this.barricadeHp)),
      maxBarricadeHp: this.maxBarricadeHp,
      zombies: this.zombies,
      powerups: this.powerups,
      players: this.getPlayers(),
      settings: this.settings,
      effects: {
        freezeRemainingMs: Math.max(0, this.freezeRemainingMs),
        doubleDamageRemainingMs: Math.max(0, this.doubleDamageRemainingMs),
      },
      intermissionCountdown: Math.ceil(this.intermissionCountdown),
      serverTickRate: this.serverTickRate,
      slowMoRemainingMs: Math.max(0, Math.round(this.slowMoRemainingMs)),
      highScores: this.highScores,
    };
  }

  // Handle Player Join / Reconnect / Mid-Game Drop-In
  public handleJoin(
    name: string,
    requestedColor?: string,
    existingToken?: string
  ): { player: PlayerInfo; token: string; isReconnect: boolean } {
    const cleanName = name?.trim() || '';

    // 1. Check for reconnect via token
    if (existingToken && this.tokenToPlayerId.has(existingToken)) {
      const existingId = this.tokenToPlayerId.get(existingToken)!;
      const existingPlayer = this.players.get(existingId);
      if (existingPlayer) {
        existingPlayer.isConnected = true;
        if (cleanName) existingPlayer.name = cleanName;
        this.broadcastLobbyUpdate();
        return { player: existingPlayer, token: existingToken, isReconnect: true };
      }
    }

    // 1b. Deduplicate 'PC Host' or reuse a disconnected slot with the same player name
    for (const existingPlayer of this.players.values()) {
      if (
        !existingPlayer.isBot &&
        ((existingPlayer.name === 'PC Host' && cleanName === 'PC Host') ||
          (!existingPlayer.isConnected && cleanName && existingPlayer.name === cleanName))
      ) {
        existingPlayer.isConnected = true;
        if (requestedColor) existingPlayer.color = requestedColor;
        this.broadcastLobbyUpdate();
        return {
          player: existingPlayer,
          token: existingPlayer.reconnectToken,
          isReconnect: true,
        };
      }
    }

    // 2. Assign slot and color
    const usedSlots = new Set(Array.from(this.players.values()).map((p) => p.slot));
    let slot = 1;
    while (usedSlots.has(slot)) slot++;

    const color =
      requestedColor ||
      PLAYER_COLORS[(slot - 1) % PLAYER_COLORS.length].hex;

    const playerId = `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const reconnectToken = `token_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const displayName = cleanName || `Player ${slot}`;
    const profile = this.getOrCreateProfile(displayName);

    const newPlayer: PlayerInfo = {
      id: playerId,
      reconnectToken,
      name: displayName,
      color,
      slot,
      isConnected: true,
      weapon: 'pistol',
      ammo: WEAPON_CONFIG.maxAmmo,
      maxAmmo: WEAPON_CONFIG.maxAmmo,
      isReloading: false,
      reloadEndTime: 0,
      autoFire: this.settings.autoFire,
      autoReload: this.settings.autoReload,
      unlimitedAmmo: this.settings.unlimitedAmmo,
      lastShotTime: 0,
      isTargetLocked: false,
      combo: 0,
      multiplier: 1,
      maxCombo: 0,
      hp: COMBO_CONFIG.playerMaxHp,
      maxHp: COMBO_CONFIG.playerMaxHp,
      isDowned: false,
      downedRemainingSec: 0,
      tickets: profile.tickets,
      unlockedRewards: [...profile.unlockedRewards],
      equippedSkin: profile.equippedSkin,
      equippedCrosshair: profile.equippedCrosshair,
      tutorialReady: false,
      crosshair: {
        x: 0.5,
        y: 0.5,
        lastUpdate: Date.now(),
      },
      stats: {
        score: 0,
        kills: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageDealt: 0,
        headshots: 0,
        civiliansHit: 0,
        revives: 0,
        coopBonuses: 0,
      },
    };

    this.players.set(playerId, newPlayer);
    this.tokenToPlayerId.set(reconnectToken, playerId);

    this.broadcastLobbyUpdate();
    return { player: newPlayer, token: reconnectToken, isReconnect: false };
  }

  public handleDisconnect(playerId: string) {
    const player = this.players.get(playerId);
    if (player) {
      if (player.name === 'PC Host') {
        this.removePlayer(playerId);
        return;
      }
      player.isConnected = false;
      this.broadcastLobbyUpdate();
    }
  }

  public removePlayer(playerId: string) {
    const player = this.players.get(playerId);
    if (player) {
      this.tokenToPlayerId.delete(player.reconnectToken);
      this.players.delete(playerId);
      this.broadcastLobbyUpdate();
    }
  }

  public broadcastLobbyUpdate() {
    this.broadcastCallback({
      type: 'lobby_update',
      players: this.getPlayers(),
      settings: this.settings,
      phase: this.phase,
    });
  }

  // Aim update from phone
  public handleAim(
    playerId: string,
    x: number,
    y: number,
    _pitch?: number,
    _yaw?: number,
    _roll?: number
  ) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Clamp coordinates to [0, 1]
    player.crosshair.x = Math.max(0.01, Math.min(0.99, x));
    player.crosshair.y = Math.max(0.01, Math.min(0.99, y));
    player.crosshair.lastUpdate = Date.now();
  }

  // Shoot action from phone or server auto-fire
  public handleShoot(playerId: string) {
    const player = this.players.get(playerId);
    if (
      !player ||
      (this.phase !== 'PLAYING' && this.phase !== 'TUTORIAL' && this.phase !== 'BONUS_ROUND')
    ) {
      return;
    }

    // Downed players cannot shoot until revived
    if (player.isDowned) {
      this.directMessageCallback(playerId, { type: 'haptic', pattern: 'empty' });
      return;
    }

    const now = Date.now();
    const weaponDef = WEAPONS[player.weapon] || WEAPONS.pistol;
    const isUnlimited = player.unlimitedAmmo ?? this.settings.unlimitedAmmo;
    const isAutoReload = player.autoReload ?? this.settings.autoReload;

    if (isUnlimited) {
      player.isReloading = false;
      player.ammo = player.maxAmmo;
    } else {
      // Check if reloading
      if (player.isReloading) {
        if (now >= player.reloadEndTime) {
          player.isReloading = false;
          player.ammo = player.maxAmmo;
        } else {
          this.directMessageCallback(playerId, { type: 'haptic', pattern: 'empty' });
          return;
        }
      }

      // Check ammo
      if (player.ammo <= 0) {
        if (!weaponDef.infiniteAmmo) {
          // Special weapon empty -> revert to Pistol automatically!
          this.handleSwitchWeapon(playerId, 'pistol');
        } else if (isAutoReload) {
          this.handleReload(playerId);
          return;
        } else {
          this.directMessageCallback(playerId, { type: 'haptic', pattern: 'empty' });
          return;
        }
      }

      // Spend ammo
      player.ammo--;
    }

    player.lastShotTime = now;
    player.stats.shotsFired++;
    this.directMessageCallback(playerId, {
      type: 'haptic',
      pattern: weaponDef.hapticPattern,
    });

    // If special weapon ran out of ammo, revert to Pistol; otherwise auto-reload Pistol if enabled
    if (!isUnlimited && player.ammo <= 0) {
      if (!weaponDef.infiniteAmmo) {
        this.handleSwitchWeapon(playerId, 'pistol');
      } else if (isAutoReload) {
        this.handleReload(playerId);
      }
    }

    // Process Hit Detection via 2D projection / raycast
    this.processPlayerShot(player, weaponDef);
  }

  // Reload action from phone
  public handleReload(playerId: string) {
    const player = this.players.get(playerId);
    if (!player || player.isReloading || player.ammo === player.maxAmmo) return;
    if (player.unlimitedAmmo ?? this.settings.unlimitedAmmo) {
      player.ammo = player.maxAmmo;
      player.isReloading = false;
      return;
    }

    const weaponDef = WEAPONS[player.weapon] || WEAPONS.pistol;
    player.isReloading = true;
    player.reloadEndTime = Date.now() + weaponDef.reloadTimeMs;
    this.directMessageCallback(playerId, { type: 'haptic', pattern: 'reload' });
  }

  public handleRecenter(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.crosshair.x = 0.5;
    player.crosshair.y = 0.5;
    player.crosshair.lastUpdate = Date.now();
  }

  public skipTutorial() {
    if (this.phase === 'TUTORIAL') {
      this.zombies = [];
      this.countdownSeconds = 3;
      this.phase = 'COUNTDOWN';
    }
  }

  public startGame(withTutorial = true) {
    if (this.players.size === 0) {
      this.spawnBots(1);
    }

    const diff = DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal;
    this.barricadeHp = diff.barricadeHp;
    this.maxBarricadeHp = diff.barricadeHp;
    this.currentWave = 1;
    this.zombies = [];
    this.powerups = [];
    this.freezeRemainingMs = 0;
    this.doubleDamageRemainingMs = 0;
    this.slowMoRemainingMs = 0;

    // Reset player stats & restore HP/Weapon
    for (const player of this.players.values()) {
      player.weapon = 'pistol';
      player.maxAmmo = WEAPONS.pistol.maxAmmo;
      player.ammo = player.maxAmmo;
      player.isReloading = false;
      player.lastShotTime = 0;
      player.isTargetLocked = false;
      player.combo = 0;
      player.multiplier = 1;
      player.maxCombo = 0;
      player.hp = COMBO_CONFIG.playerMaxHp;
      player.maxHp = COMBO_CONFIG.playerMaxHp;
      player.isDowned = false;
      player.downedRemainingSec = 0;
      player.tutorialReady = false;
      player.stats = {
        score: 0,
        kills: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageDealt: 0,
        headshots: 0,
        civiliansHit: 0,
        revives: 0,
        coopBonuses: 0,
      };
    }

    if (withTutorial) {
      this.phase = 'TUTORIAL';
      this.countdownSeconds = 7;
      this.spawnTutorialTargets();
    } else {
      this.countdownSeconds = 3;
      this.phase = 'COUNTDOWN';
    }

    this.broadcastLobbyUpdate();
  }

  private spawnTutorialTargets() {
    this.zombies = [];
    const positions = [-4.2, 0, 4.2];
    for (let i = 0; i < positions.length; i++) {
      this.zombies.push({
        id: `z_tut_${this.zombieIdCounter++}`,
        type: 'normal',
        x: positions[i],
        y: 0,
        z: -11,
        hp: 25,
        maxHp: 25,
        speed: 0,
        damage: 0,
        radius: 1.0,
        isFrozen: false,
        state: 'walking',
        theme: this.settings.theme,
        isBonusTarget: true,
      });
    }
  }

  private startBonusRound() {
    this.phase = 'BONUS_ROUND';
    this.intermissionCountdown = 8;
    this.zombies = [];
    this.nextWaveSpawnQueue = [];

    // Spawn 6 bonus drones/targets across the screen + 2 weapon crates!
    for (let i = 0; i < 6; i++) {
      this.zombies.push({
        id: `z_bonus_${this.zombieIdCounter++}`,
        type: 'fast',
        x: -7.5 + i * 3.0,
        y: 1.2 + (i % 2) * 1.4,
        z: -10 - (i % 3) * 2.5,
        hp: 25,
        maxHp: 25,
        speed: 1.2,
        damage: 0,
        radius: 1.0,
        isFrozen: false,
        state: 'walking',
        theme: this.settings.theme,
        isBonusTarget: true,
        targetX: 7.5 - i * 3.0,
      });
    }

    this.spawnWeaponCrate(-3.5, 1.5, -9.0);
    this.spawnWeaponCrate(3.5, 1.5, -9.0);
  }

  public restartGame() {
    this.phase = 'LOBBY';
    this.zombies = [];
    this.powerups = [];
    this.slowMoRemainingMs = 0;
    this.broadcastLobbyUpdate();
  }

  public spawnBots(count: number) {
    const usedSlots = new Set(Array.from(this.players.values()).map((p) => p.slot));
    for (let i = 0; i < count; i++) {
      if (this.players.size >= 8) break;
      let slot = 1;
      while (usedSlots.has(slot)) slot++;
      usedSlots.add(slot);

      const botId = `bot_${Date.now()}_${i}_${slot}`;
      const color = PLAYER_COLORS[(slot - 1) % PLAYER_COLORS.length].hex;
      const botPlayer: PlayerInfo = {
        id: botId,
        reconnectToken: `bot_token_${botId}`,
        name: `Bot Agent ${slot}`,
        color,
        slot,
        isConnected: true,
        isBot: true,
        weapon: 'pistol',
        ammo: WEAPON_CONFIG.maxAmmo,
        maxAmmo: WEAPON_CONFIG.maxAmmo,
        isReloading: false,
        reloadEndTime: 0,
        autoFire: true,
        autoReload: true,
        unlimitedAmmo: this.settings.unlimitedAmmo,
        lastShotTime: 0,
        isTargetLocked: false,
        combo: 0,
        multiplier: 1,
        maxCombo: 0,
        hp: COMBO_CONFIG.playerMaxHp,
        maxHp: COMBO_CONFIG.playerMaxHp,
        isDowned: false,
        downedRemainingSec: 0,
        tickets: 0,
        unlockedRewards: ['skin_default', 'crosshair_default'],
        equippedSkin: 'skin_default',
        equippedCrosshair: 'crosshair_default',
        crosshair: { x: 0.5, y: 0.5, lastUpdate: Date.now() },
        stats: { score: 0, kills: 0, shotsFired: 0, shotsHit: 0, damageDealt: 0, headshots: 0 },
      };
      this.players.set(botId, botPlayer);
      this.tokenToPlayerId.set(botPlayer.reconnectToken, botId);
    }
    this.broadcastLobbyUpdate();
  }

  public removeBots() {
    for (const [id, player] of this.players.entries()) {
      if (player.isBot) {
        this.tokenToPlayerId.delete(player.reconnectToken);
        this.players.delete(id);
      }
    }
    this.broadcastLobbyUpdate();
  }

  /**
   * Phase 7: Deterministic Screenshot / Visual Review Scene (Key F4)
   * Spawns 4 bots, a Boss with active weak point, 4 zombies across lanes, and sets Stage 2 (Bio-Lab Reactor) by default.
   */
  public triggerReviewScene(stageIndex = 1) {
    this.removeBots();
    const currentConnected = Array.from(this.players.values()).filter((p) => p.isConnected);
    const neededBots = Math.max(0, 4 - currentConnected.length);
    if (neededBots > 0) {
      this.spawnBots(neededBots);
    }

    const clampedStage = Math.max(0, Math.min(STAGES.length - 1, stageIndex));
    this.currentWave = clampedStage * 2 + 1; // Wave 3 = Stage 2: Bio-Lab Reactor
    this.phase = 'PLAYING';
    this.barricadeHp = 84;
    this.maxBarricadeHp = 100;
    this.nextWaveSpawnQueue = [];
    this.zombies = [];
    this.powerups = [];

    const stage = this.getCurrentStage();
    const activePlayers = Array.from(this.players.values())
      .filter((p) => p.isConnected)
      .sort((a, b) => a.slot - b.slot)
      .slice(0, 4);

    const weapons: WeaponType[] = ['pistol', 'shotgun', 'machine_gun', 'grenade_launcher'];
    const combos = [
      { combo: 4, mult: 2, score: 1420, x: 0.34, y: 0.48 },
      { combo: 9, mult: 4, score: 2890, x: 0.5, y: 0.38 },
      { combo: 24, mult: 8, score: 5640, x: 0.64, y: 0.46 },
      { combo: 2, mult: 1, score: 980, x: 0.44, y: 0.52 },
    ];

    activePlayers.forEach((p, idx) => {
      const w = weapons[idx % weapons.length];
      p.weapon = w;
      p.maxAmmo = WEAPONS[w].maxAmmo;
      p.ammo = Math.max(2, WEAPONS[w].maxAmmo - 2);
      p.combo = combos[idx].combo;
      p.multiplier = combos[idx].mult;
      p.stats.score = combos[idx].score;
      p.crosshair.x = combos[idx].x;
      p.crosshair.y = combos[idx].y;
    });

    // Spawn deterministic Boss in center lane + 4 zombies across left/right lanes
    this.zombies.push(
      {
        id: 'z_review_boss',
        type: 'boss',
        x: 0.0,
        y: 0,
        z: -13.5,
        hp: 520,
        maxHp: 800,
        speed: 0.45,
        damage: 18,
        radius: 1.8,
        isFrozen: false,
        state: 'walking',
        theme: stage.theme,
        weakPoint: {
          offsetY: stage.bossWeakPointOffsetY,
          radius: stage.bossWeakPointRadius,
          active: true,
        },
      },
      {
        id: 'z_review_normal_l',
        type: 'normal',
        x: -3.8,
        y: 0,
        z: -9.8,
        hp: 75,
        maxHp: 100,
        speed: 0.8,
        damage: 6,
        radius: 1.0,
        isFrozen: false,
        state: 'walking',
        theme: stage.theme,
      },
      {
        id: 'z_review_fast_l',
        type: 'fast',
        x: -1.9,
        y: 0,
        z: -8.2,
        hp: 55,
        maxHp: 70,
        speed: 1.1,
        damage: 5,
        radius: 0.9,
        isFrozen: false,
        state: 'walking',
        theme: stage.theme,
      },
      {
        id: 'z_review_tank_r',
        type: 'tank',
        x: 3.4,
        y: 0,
        z: -10.6,
        hp: 210,
        maxHp: 280,
        speed: 0.6,
        damage: 12,
        radius: 1.4,
        isFrozen: false,
        state: 'walking',
        theme: stage.theme,
      },
      {
        id: 'z_review_normal_r',
        type: 'normal',
        x: 1.8,
        y: 0,
        z: -9.0,
        hp: 80,
        maxHp: 100,
        speed: 0.8,
        damage: 6,
        radius: 1.0,
        isFrozen: false,
        state: 'walking',
        theme: stage.theme,
      }
    );

    this.broadcastCallback({
      type: 'boss_spawned',
      zombieId: 'z_review_boss',
      bossName: stage.bossName,
      position: { x: 0, y: 0, z: -13.5 },
    });
    this.broadcastCallback({
      type: 'game_tick',
      world: this.getWorldState(),
    });
  }

  // Evaluate whether normalized screen coordinates (px, py) hit a specific zombie
  // Uses authoritative ZOMBIE_HITBOXES (head sphere + body capsule + optional Boss weak point)
  public checkZombieHit(
    px: number,
    py: number,
    zombie: ZombieState
  ): { hit: boolean; isHeadshot: boolean; isWeakPoint?: boolean } {
    const hitbox = ZOMBIE_HITBOXES[zombie.type] || ZOMBIE_HITBOXES.normal;
    const s = ZOMBIE_VISUAL_SCALE;
    const baseY = zombie.y || 0;
    const depth = Math.max(1.2, 5.0 - zombie.z);

    // 0. Check Boss Weak Point first if active!
    if (zombie.weakPoint?.active) {
      const wpWorldY = baseY + zombie.weakPoint.offsetY * s;
      const wpWorldRadius = zombie.weakPoint.radius * s;
      const wpScreen = this.projectWorldToScreen(zombie.x, wpWorldY, zombie.z);
      const wpScreenRadius = Math.max(0.042, (wpWorldRadius * 1.2) / depth);
      if (Math.hypot(px - wpScreen.x, py - wpScreen.y) <= wpScreenRadius) {
        return { hit: true, isHeadshot: true, isWeakPoint: true };
      }
    }

    // 1. Head Sphere Hitbox in World Space
    const headWorldY = baseY + hitbox.headSphere.offsetY * s;
    const headWorldRadius = hitbox.headSphere.radius * s;
    const headScreen = this.projectWorldToScreen(zombie.x, headWorldY, zombie.z);

    // 2. Body Capsule Hitbox (bottom sphere to top sphere + cylinder spine) in World Space
    const capsuleBottomY = baseY + hitbox.bodyCapsule.bottomY * s;
    const capsuleTopY = baseY + hitbox.bodyCapsule.topY * s;
    const capsuleCenterY = (capsuleBottomY + capsuleTopY) * 0.5;
    const capsuleWorldRadius = hitbox.bodyCapsule.radius * s;

    const bottomScreen = this.projectWorldToScreen(zombie.x, capsuleBottomY, zombie.z);
    const centerScreen = this.projectWorldToScreen(zombie.x, capsuleCenterY, zombie.z);
    const topScreen = this.projectWorldToScreen(zombie.x, capsuleTopY, zombie.z);

    const headScreenRadius = Math.max(0.038, (headWorldRadius * 1.15) / depth);
    const bodyScreenRadius = Math.max(0.055, (capsuleWorldRadius * 1.25) / depth);

    // Check Head Sphere first
    const distHead = Math.hypot(px - headScreen.x, py - headScreen.y);
    if (distHead <= headScreenRadius) {
      return { hit: true, isHeadshot: true, isWeakPoint: false };
    }

    // Check Body Capsule (closest point along vertical segment [topScreen.y .. bottomScreen.y])
    const minY = Math.min(topScreen.y, bottomScreen.y) - bodyScreenRadius * 0.35;
    const maxY = Math.max(topScreen.y, bottomScreen.y) + bodyScreenRadius * 0.35;
    const clampedSpineY = Math.max(minY, Math.min(maxY, py));
    const distCapsule = Math.hypot(px - centerScreen.x, py - clampedSpineY);

    if (distCapsule <= bodyScreenRadius) {
      return { hit: true, isHeadshot: false, isWeakPoint: false };
    }

    return { hit: false, isHeadshot: false, isWeakPoint: false };
  }

  // Get screen position for a downed player's revive target beacon
  public getDownedBeaconScreenPos(player: PlayerInfo): { x: number; y: number } {
    const x = Math.max(0.15, Math.min(0.85, 0.15 + ((player.slot - 1) % 5) * 0.175));
    return { x, y: 0.72 };
  }

  // Check if crosshair is currently pointing at any active hostile zombie, power-up crate, or downed teammate
  private isCrosshairOnAnyTarget(px: number, py: number, shooterId?: string): boolean {
    for (const p of this.powerups) {
      const screenPos = this.projectWorldToScreen(p.x, p.y, p.z);
      if (Math.hypot(px - screenPos.x, py - screenPos.y) < 0.085) {
        return true;
      }
    }

    // Check downed teammates for revive target
    for (const teammate of this.players.values()) {
      if (teammate.id !== shooterId && teammate.isDowned && teammate.isConnected) {
        const beacon = this.getDownedBeaconScreenPos(teammate);
        if (Math.hypot(px - beacon.x, py - beacon.y) < 0.09) {
          return true;
        }
      }
    }

    for (const z of this.zombies) {
      if (z.state !== 'walking' && z.state !== 'attacking') continue;
      // Never auto-fire on friendly Civilians!
      if (z.isCivilian) continue;
      if (this.checkZombieHit(px, py, z).hit) {
        return true;
      }
    }

    return false;
  }

  public revivePlayer(reviverId: string, downedPlayerId: string): boolean {
    const reviver = this.players.get(reviverId);
    const downed = this.players.get(downedPlayerId);
    if (!reviver || !downed || !downed.isDowned) return false;

    downed.isDowned = false;
    downed.downedRemainingSec = 0;
    downed.hp = downed.maxHp;
    reviver.stats.score += 200;
    reviver.stats.revives = (reviver.stats.revives || 0) + 1;

    this.broadcastCallback({
      type: 'player_revived',
      playerId: downed.id,
      reviverId: reviver.id,
      playerName: downed.name,
      reviverName: reviver.name,
    });
    return true;
  }

  // Hit detection logic against 3D screen projected targets
  private processPlayerShot(player: PlayerInfo, weaponDef = WEAPONS.pistol) {
    const px = player.crosshair.x;
    const py = player.crosshair.y;

    // 1. Check hit on downed teammate revive beacons first!
    for (const teammate of this.players.values()) {
      if (teammate.id !== player.id && teammate.isDowned) {
        const beacon = this.getDownedBeaconScreenPos(teammate);
        if (Math.hypot(px - beacon.x, py - beacon.y) < 0.095) {
          this.revivePlayer(player.id, teammate.id);
          this.directMessageCallback(player.id, { type: 'haptic', pattern: 'hit' });
          return;
        }
      }
    }

    // 2. Check hit on power-up / weapon crates!
    for (let i = 0; i < this.powerups.length; i++) {
      const p = this.powerups[i];
      const screenPos = this.projectWorldToScreen(p.x, p.y, p.z);
      const dist = Math.hypot(px - screenPos.x, py - screenPos.y);

      if (dist < 0.085) {
        this.activatePowerUp(player, p);
        this.powerups.splice(i, 1);
        player.stats.score += 75;
        this.directMessageCallback(player.id, { type: 'haptic', pattern: 'hit' });
        return;
      }
    }

    // 3. Check hit on Zombies & Civilians (sort front to back, closest to camera first)
    const activeZombies = this.zombies
      .filter((z) => z.state === 'walking' || z.state === 'attacking')
      .sort((a, b) => b.z - a.z);

    let anyHit = false;
    const pellets = Math.max(1, weaponDef.pellets);

    for (let pelletIdx = 0; pelletIdx < pellets; pelletIdx++) {
      const offsetX =
        pelletIdx === 0 ? 0 : (Math.random() - 0.5) * weaponDef.spread * 2;
      const offsetY =
        pelletIdx === 0 ? 0 : (Math.random() - 0.5) * weaponDef.spread * 2;
      const shotX = Math.max(0.01, Math.min(0.99, px + offsetX));
      const shotY = Math.max(0.01, Math.min(0.99, py + offsetY));

      for (const zombie of activeZombies) {
        if (zombie.hp <= 0 || zombie.state === 'dying') continue;
        const hitResult = this.checkZombieHit(shotX, shotY, zombie);
        if (!hitResult.hit) continue;

        anyHit = true;

        // Did the player shoot a friendly Civilian?
        if (zombie.isCivilian) {
          zombie.state = 'dying';
          zombie.deathProgress = 0;
          player.combo = 0;
          player.multiplier = 1;
          player.stats.civiliansHit = (player.stats.civiliansHit || 0) + 1;
          player.stats.score = Math.max(0, player.stats.score - COMBO_CONFIG.civilianPenaltyScore);

          this.broadcastCallback({
            type: 'civilian_hit',
            playerId: player.id,
            playerName: player.name,
            penalty: COMBO_CONFIG.civilianPenaltyScore,
            position: { x: zombie.x, y: zombie.y, z: zombie.z },
          });
          this.directMessageCallback(player.id, { type: 'haptic', pattern: 'damage' });
          break;
        }

        // Valid hostile zombie or bonus target hit!
        this.applyZombieDamage(
          player,
          zombie,
          weaponDef,
          hitResult.isHeadshot,
          Boolean(hitResult.isWeakPoint),
          pelletIdx === 0
        );

        // If weapon has AoE splash radius (e.g. Grenade Launcher or Shotgun close blast), damage nearby hostile zombies!
        if (pelletIdx === 0 && weaponDef.splashRadius > 0.5) {
          for (const other of activeZombies) {
            if (other.id === zombie.id || other.isCivilian || other.hp <= 0) continue;
            const dist3D = Math.hypot(other.x - zombie.x, other.z - zombie.z);
            if (dist3D <= weaponDef.splashRadius) {
              this.applyZombieDamage(player, other, weaponDef, false, false, false, 0.65);
            }
          }
        }

        break; // Each pellet hits 1 primary target
      }
    }

    // If player missed completely during PLAYING, reset combo streak
    if (!anyHit && this.phase === 'PLAYING') {
      player.combo = 0;
      player.multiplier = 1;
    }
  }

  private applyZombieDamage(
    player: PlayerInfo,
    zombie: ZombieState,
    weaponDef = WEAPONS.pistol,
    isHeadshot = false,
    isWeakPoint = false,
    countStats = true,
    splashScale = 1.0
  ) {
    const now = Date.now();
    if (countStats) {
      player.stats.shotsHit++;
      player.combo++;
      player.maxCombo = Math.max(player.maxCombo, player.combo);
      player.multiplier = Math.min(
        COMBO_CONFIG.maxMultiplier,
        1 + Math.floor(player.combo / COMBO_CONFIG.hitsPerMultiplierTier)
      );
    }

    let damage = Math.round(weaponDef.damage * splashScale);
    if (isWeakPoint) {
      damage = Math.round(damage * weaponDef.headshotMultiplier * 1.5);
      if (countStats) player.stats.headshots++;
    } else if (isHeadshot) {
      damage = Math.round(damage * weaponDef.headshotMultiplier);
      if (countStats) player.stats.headshots++;
    }

    if (this.doubleDamageRemainingMs > 0) {
      damage *= 2;
    }

    zombie.hp -= damage;
    zombie.staggerTimer = 0.22; // Trigger visual hit stagger/flinch
    player.stats.damageDealt += damage;

    const baseHitPoints = isWeakPoint ? 90 : isHeadshot ? 50 : 20;
    const scoreAwarded = baseHitPoints * player.multiplier;
    player.stats.score += scoreAwarded;

    // Track Co-Op Crossfire hits on this zombie
    if (!zombie.lastHitBy) zombie.lastHitBy = [];
    zombie.lastHitBy = zombie.lastHitBy.filter(
      (entry) => now - entry.time <= COMBO_CONFIG.coopWindowMs
    );
    const otherCheck = zombie.lastHitBy.find((entry) => entry.playerId !== player.id);
    zombie.lastHitBy.push({ playerId: player.id, time: now });

    if (otherCheck && countStats) {
      const teammate = this.players.get(otherCheck.playerId);
      if (teammate) {
        player.stats.score += COMBO_CONFIG.coopBonusScore;
        teammate.stats.score += COMBO_CONFIG.coopBonusScore;
        player.stats.coopBonuses = (player.stats.coopBonuses || 0) + 1;
        teammate.stats.coopBonuses = (teammate.stats.coopBonuses || 0) + 1;
        // Clear so we don't spam co-op bonus on every single SMG bullet
        zombie.lastHitBy = [];
        this.broadcastCallback({
          type: 'coop_combo',
          playerIds: [player.id, teammate.id],
          playerNames: [player.name, teammate.name],
          bonusScore: COMBO_CONFIG.coopBonusScore,
          position: { x: zombie.x, y: zombie.y, z: zombie.z },
        });
      }
    }

    const killed = zombie.hp <= 0;
    const isBossKill = killed && zombie.type === 'boss';

    if (killed) {
      zombie.state = 'dying';
      zombie.deathProgress = 0;
      zombie.deathVariant = Math.floor(Math.random() * 3); // 3 varied death tumble styles
      player.stats.kills++;
      const killBonus =
        (zombie.type === 'boss' ? 500 : zombie.type === 'tank' ? 150 : 50) *
        player.multiplier;
      player.stats.score += killBonus;

      // Award arcade tickets for progression rewards
      const ticketsEarned = zombie.type === 'boss' ? 8 : zombie.type === 'tank' ? 2 : 1;
      player.tickets += ticketsEarned;
      this.syncPlayerToProfile(player);

      if (isBossKill) {
        this.slowMoRemainingMs = 2200; // Dramatic slow-motion on Boss kills!
      }

      if (this.phase === 'PLAYING') {
        this.maybeSpawnPowerUp(zombie.x, zombie.y, zombie.z);
      }
    }

    // Send hit event
    this.broadcastCallback({
      type: 'hit_event',
      playerId: player.id,
      zombieId: zombie.id,
      zombieType: zombie.type,
      weapon: player.weapon,
      headshot: isHeadshot,
      weakPointHit: isWeakPoint,
      damage,
      scoreAwarded,
      combo: player.combo,
      multiplier: player.multiplier,
      killed,
      isBossKill,
      position: { x: zombie.x, y: zombie.y, z: zombie.z },
    });

    if (countStats) {
      this.directMessageCallback(player.id, {
        type: 'haptic',
        pattern: 'hit',
        headshot: isHeadshot,
      });
    }
  }

  // Exact 3D camera projection matching Three.js PerspectiveCamera
  // Camera at (0, 2.4, 5.0) looking at (0, 1.2, -18.0) with FOV 56deg
  public projectWorldToScreen(
    x: number,
    y: number,
    z: number,
    aspect = 16 / 9
  ): { x: number; y: number } {
    const dx = x;
    const dy = y - 2.4;
    const dz = z - 5.0;

    // View direction forward and up components (pitch angle tilt ~3.0deg)
    const zCam = dy * -0.052103 + dz * -0.998642;
    const yCam = dy * 0.998642 + dz * -0.052103;
    const xCam = dx;

    if (zCam <= 0.2) return { x: 0.5, y: 0.5 };

    const focalY = 0.940363;
    const focalX = focalY / aspect;

    const screenX = 0.5 + (xCam / zCam) * focalX;
    const screenY = 0.5 - (yCam / zCam) * focalY;

    return {
      x: Math.max(0.01, Math.min(0.99, screenX)),
      y: Math.max(0.01, Math.min(0.99, screenY)),
    };
  }

  public spawnWeaponCrate(x: number, y: number, z: number, specificWeapon?: WeaponType) {
    const specialWeapons: WeaponType[] = ['shotgun', 'machine_gun', 'grenade_launcher'];
    const weaponGrant =
      specificWeapon || specialWeapons[Math.floor(Math.random() * specialWeapons.length)];
    this.powerups.push({
      id: `pw_${this.powerupIdCounter++}`,
      type: 'weapon_crate',
      weaponGrant,
      x,
      y: Math.max(1.2, y),
      z: Math.min(-4, z),
      createdAt: Date.now(),
    });
  }

  private maybeSpawnPowerUp(x: number, y: number, z: number) {
    const types: PowerUpType[] = [
      'ammo',
      'health',
      'freeze',
      'double_damage',
      'weapon_crate',
      'weapon_crate',
    ];
    const roll = Math.random();
    if (roll < 0.34) {
      const type = types[Math.floor(Math.random() * types.length)];
      if (type === 'weapon_crate') {
        this.spawnWeaponCrate(x, y, z);
      } else {
        this.powerups.push({
          id: `pw_${this.powerupIdCounter++}`,
          type,
          x,
          y: Math.max(1.2, y),
          z: Math.min(-4, z),
          createdAt: Date.now(),
        });
      }
    }
  }

  private activatePowerUp(player: PlayerInfo, powerup: PowerUpState) {
    let weaponGranted: WeaponType | undefined;

    if (powerup.type === 'weapon_crate') {
      const specialWeapons: WeaponType[] = ['shotgun', 'machine_gun', 'grenade_launcher'];
      weaponGranted =
        powerup.weaponGrant ||
        specialWeapons[Math.floor(Math.random() * specialWeapons.length)];
      this.handleSwitchWeapon(player.id, weaponGranted);
    } else if (powerup.type === 'ammo') {
      player.ammo = player.maxAmmo;
      player.isReloading = false;
    } else if (powerup.type === 'health') {
      this.barricadeHp = Math.min(
        this.maxBarricadeHp,
        this.barricadeHp + POWERUP_CONFIG.healAmount
      );
      player.hp = Math.min(player.maxHp, player.hp + 40);
    } else if (powerup.type === 'freeze') {
      this.freezeRemainingMs = POWERUP_CONFIG.freezeDurationMs;
    } else if (powerup.type === 'double_damage') {
      this.doubleDamageRemainingMs = POWERUP_CONFIG.doubleDamageDurationMs;
    }

    this.broadcastCallback({
      type: 'powerup_collected',
      playerId: player.id,
      powerupType: powerup.type,
      weaponGranted,
    });
  }

  private prepareWave(waveNumber: number) {
    const diff = DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal;
    const baseCount = Math.round((5 + waveNumber * 3) * diff.zombieCountMultiplier);
    const queue: { type: ZombieType; delay: number; isCivilian?: boolean }[] = [];

    // Every 2nd wave is a Stage Boss wave (Wave 2 = Stage 1 Boss, Wave 4 = Stage 2 Boss, Wave 6 = Stage 3 Boss)
    const isBossWave = waveNumber % 2 === 0 || waveNumber === this.settings.maxWaves;

    if (isBossWave) {
      queue.push({ type: 'boss', delay: 2.0 });
    }

    for (let i = 0; i < baseCount; i++) {
      // Occasionally spawn a Civilian fleeing through the street
      if (i > 1 && i % 6 === 0) {
        queue.push({ type: 'normal', delay: 0.9, isCivilian: true });
      }

      const rand = Math.random();
      let type: ZombieType = 'normal';
      if (rand < 0.25 + waveNumber * 0.03) {
        type = 'fast';
      } else if (rand < 0.45 + waveNumber * 0.04) {
        type = 'tank';
      }
      queue.push({ type, delay: 0.6 + Math.random() * 1.6 });
    }

    this.nextWaveSpawnQueue = queue;
  }

  public spawnCivilian(x = -9.5, z = -14): ZombieState {
    const civilian: ZombieState = {
      id: `civ_${this.zombieIdCounter++}`,
      type: 'normal',
      x,
      y: 0,
      z,
      hp: 20,
      maxHp: 20,
      speed: 2.2,
      damage: 0,
      radius: 1.0,
      isFrozen: false,
      state: 'walking',
      theme: this.settings.theme,
      spawnOrigin: 'left_alley',
      targetX: -x,
      isCivilian: true,
    };
    this.zombies.push(civilian);
    return civilian;
  }

  private spawnZombie(type: ZombieType, isCivilian = false) {
    if (isCivilian) {
      const fromLeft = Math.random() < 0.5;
      this.spawnCivilian(fromLeft ? -11 : 11, -11 - Math.random() * 7);
      return;
    }

    const stage = this.getCurrentStage();
    const themeKey = this.settings.theme;
    const themeDef = (themesData.themes as any)[themeKey] || themesData.themes.classic;
    const typeDef = themeDef.types[type];

    const diff = DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal;
    const kidsHpMult = this.settings.mode === 'kids' ? 0.8 : 1.0;
    const hp = Math.round(typeDef.hp * diff.hpMultiplier * kidsHpMult);
    const speed =
      typeDef.speed * diff.speedMultiplier * (this.settings.mode === 'kids' ? 0.75 : 1.0);

    let spawnOrigin: ZombieSpawnOrigin = 'street_front';
    const roll = Math.random();
    if (type === 'boss') {
      spawnOrigin = 'street_front';
    } else if (roll < 0.25) {
      spawnOrigin = 'left_alley';
    } else if (roll < 0.50) {
      spawnOrigin = 'right_alley';
    } else if (roll < 0.74) {
      spawnOrigin = 'tree_leap';
    } else if (roll < 0.88 && type !== 'tank') {
      spawnOrigin = 'rooftop_drop';
    } else {
      spawnOrigin = 'street_front';
    }

    let x = 0;
    let y = 0;
    let z = -24;
    let vy = 0;
    let targetX = (Math.random() - 0.5) * 7.5;

    if (spawnOrigin === 'left_alley') {
      x = -13.5;
      z = -10 - Math.random() * 12;
      targetX = -4.2 + Math.random() * 6.5;
    } else if (spawnOrigin === 'right_alley') {
      x = 13.5;
      z = -10 - Math.random() * 12;
      targetX = 4.2 - Math.random() * 6.5;
    } else if (spawnOrigin === 'tree_leap') {
      const fromLeft = Math.random() < 0.5;
      x = fromLeft ? -9.8 : 9.8;
      y = 0.25;
      z = -9 - Math.random() * 11;
      vy = 6.5 + Math.random() * 2.0;
      targetX = fromLeft ? -3.5 + Math.random() * 5.0 : 3.5 - Math.random() * 5.0;
    } else if (spawnOrigin === 'rooftop_drop') {
      x = (Math.random() - 0.5) * 9.5;
      y = 8.5 + Math.random() * 2.5;
      z = -11 - Math.random() * 9;
      vy = -1.5;
      targetX = x * 0.75;
    } else {
      x = (Math.random() - 0.5) * 10;
      z = -23 - Math.random() * 5;
      targetX = (Math.random() - 0.5) * 6.5;
    }

    const radius = typeDef.scale || 1.0;

    const zombie: ZombieState = {
      id: `z_${this.zombieIdCounter++}`,
      type,
      x,
      y,
      z,
      hp,
      maxHp: hp,
      speed,
      damage: type === 'boss' ? 25 : type === 'tank' ? 15 : 6,
      radius,
      isFrozen: false,
      state: 'walking',
      theme: themeKey,
      spawnOrigin,
      targetX,
      vy,
      strafePhase: Math.random() * Math.PI * 2,
      weakPoint:
        type === 'boss'
          ? {
              offsetY: stage.bossWeakPointOffsetY,
              radius: stage.bossWeakPointRadius,
              active: true,
            }
          : undefined,
    };

    this.zombies.push(zombie);

    if (type === 'boss') {
      this.broadcastCallback({
        type: 'boss_spawned',
        zombieId: zombie.id,
        bossName: stage.bossName,
        position: { x: zombie.x, y: zombie.y, z: zombie.z },
      });
    }
  }

  // Main 30Hz Tick Loop
  public tick() {
    const now = Date.now();
    const rawDt = Math.max(0.001, (now - this.lastTickTime) / 1000);
    const dt = Math.min(rawDt, 0.1);
    this.serverTickRate = Math.round(1 / Math.max(0.016, Math.min(0.1, rawDt)));
    this.lastTickTime = now;

    // Apply slow-motion time scale on Boss kills
    if (this.slowMoRemainingMs > 0) {
      this.slowMoRemainingMs = Math.max(0, this.slowMoRemainingMs - dt * 1000);
    }
    const worldDt = this.slowMoRemainingMs > 0 ? dt * 0.35 : dt;

    // Check Reload timers, Downed timers, Target Lock, and Auto-Fire for all players
    for (const player of this.players.values()) {
      const weaponDef = WEAPONS[player.weapon] || WEAPONS.pistol;
      const isUnlimited = player.unlimitedAmmo ?? this.settings.unlimitedAmmo;
      const isAutoReload = player.autoReload ?? this.settings.autoReload;
      const isAutoFire = player.autoFire ?? this.settings.autoFire;

      // Update downed countdown timer (10s window)
      if (player.isDowned) {
        player.downedRemainingSec -= dt;
        if (player.downedRemainingSec <= 0) {
          // Auto-continue after 10 seconds with 50% HP so party game keeps flowing
          player.isDowned = false;
          player.downedRemainingSec = 0;
          player.hp = Math.round(player.maxHp * 0.5);
        }
        player.isTargetLocked = false;
        continue;
      }

      if (isUnlimited) {
        player.isReloading = false;
        player.ammo = player.maxAmmo;
      } else if (player.isReloading && now >= player.reloadEndTime) {
        player.isReloading = false;
        player.ammo = player.maxAmmo;
      } else if (!player.isReloading && player.ammo <= 0) {
        if (!weaponDef.infiniteAmmo) {
          this.handleSwitchWeapon(player.id, 'pistol');
        } else if (isAutoReload) {
          this.handleReload(player.id);
        }
      }

      if (
        this.phase === 'PLAYING' ||
        this.phase === 'TUTORIAL' ||
        this.phase === 'BONUS_ROUND'
      ) {
        if (player.isBot) {
          this.updateBotPlayer(player, dt);
        }

        const locked = this.isCrosshairOnAnyTarget(
          player.crosshair.x,
          player.crosshair.y,
          player.id
        );
        player.isTargetLocked = locked;

        // Auto-Fire when pointing at a hostile zombie, crate, or downed teammate beacon
        if (
          !player.isBot &&
          isAutoFire &&
          locked &&
          !player.isReloading &&
          (player.ammo > 0 || isUnlimited) &&
          now - (player.lastShotTime || 0) >= weaponDef.autoFireIntervalMs
        ) {
          this.handleShoot(player.id);
        }
      } else {
        player.isTargetLocked = false;
      }
    }

    // Active power-up timers
    if (this.freezeRemainingMs > 0) {
      this.freezeRemainingMs -= dt * 1000;
    }
    if (this.doubleDamageRemainingMs > 0) {
      this.doubleDamageRemainingMs -= dt * 1000;
    }

    // State machine updates
    if (this.phase === 'TUTORIAL') {
      this.countdownSeconds -= dt;
      // Update dying tutorial targets
      for (let i = this.zombies.length - 1; i >= 0; i--) {
        const z = this.zombies[i];
        if (z.state === 'dying') {
          z.deathProgress = (z.deathProgress || 0) + dt * 2.0;
          if (z.deathProgress >= 1.0) this.zombies.splice(i, 1);
        }
      }
      if (this.countdownSeconds <= 0 || this.zombies.length === 0) {
        this.zombies = [];
        this.countdownSeconds = 3;
        this.phase = 'COUNTDOWN';
      }
    } else if (this.phase === 'COUNTDOWN') {
      this.countdownSeconds -= dt;
      if (this.countdownSeconds <= 0) {
        this.phase = 'PLAYING';
        this.prepareWave(this.currentWave);
      }
    } else if (this.phase === 'PLAYING') {
      this.updatePlayingState(worldDt);
    } else if (this.phase === 'BONUS_ROUND') {
      this.intermissionCountdown -= dt;
      this.updateBonusRoundState(dt);
      if (this.intermissionCountdown <= 0 || this.zombies.length === 0) {
        this.zombies = [];
        this.currentWave++;
        this.phase = 'PLAYING';
        this.prepareWave(this.currentWave);
      }
    } else if (this.phase === 'WAVE_CLEARED') {
      this.intermissionCountdown -= dt;
      if (this.intermissionCountdown <= 0) {
        if (this.currentWave >= this.settings.maxWaves) {
          this.phase = 'VICTORY';
        } else if (this.currentWave % 2 === 0) {
          // End of a Stage Boss wave -> launch Bonus Round before next Stage!
          this.startBonusRound();
        } else {
          this.currentWave++;
          this.phase = 'PLAYING';
          this.prepareWave(this.currentWave);
        }
      }
    }

    // Broadcast world state
    this.broadcastCallback({
      type: 'game_tick',
      world: this.getWorldState(),
    });
  }

  private updateBonusRoundState(dt: number) {
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.state === 'dying') {
        z.deathProgress = (z.deathProgress || 0) + dt * 2.0;
        if (z.deathProgress >= 1.0) this.zombies.splice(i, 1);
        continue;
      }
      z.strafePhase = (z.strafePhase || 0) + dt * 2.5;
      z.x += Math.sin(z.strafePhase) * dt * 3.2;
      z.y = Math.max(0.8, 1.4 + Math.cos(z.strafePhase * 1.3) * 0.6);
    }
  }

  private updatePlayingState(dt: number) {
    // Process spawn queue
    if (this.nextWaveSpawnQueue.length > 0) {
      this.nextWaveSpawnQueue[0].delay -= dt;
      if (this.nextWaveSpawnQueue[0].delay <= 0) {
        const item = this.nextWaveSpawnQueue.shift()!;
        this.spawnZombie(item.type, Boolean(item.isCivilian));
      }
    }

    const isFrozen = this.freezeRemainingMs > 0;

    // Update zombies & civilians
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      z.isFrozen = isFrozen;

      if (z.staggerTimer && z.staggerTimer > 0) {
        z.staggerTimer = Math.max(0, z.staggerTimer - dt);
      }

      if (z.state === 'dying') {
        z.deathProgress = (z.deathProgress || 0) + dt * 1.4;
        if (z.deathProgress >= 1.0) {
          this.zombies.splice(i, 1);
        }
        continue;
      }

      // Civilians sprint across the street to safety and despawn once they reach the other side
      if (z.isCivilian) {
        const targetX = z.targetX ?? 10;
        const dir = Math.sign(targetX - z.x) || 1;
        z.x += dir * z.speed * 2.4 * dt;
        if (Math.abs(targetX - z.x) < 0.6) {
          this.zombies.splice(i, 1);
        }
        continue;
      }

      if (!isFrozen) {
        // Slightly slow movement while staggering from a hit
        const staggerFactor = z.staggerTimer && z.staggerTimer > 0 ? 0.25 : 1.0;

        // 1. Vertical jump / rooftop drop physics
        if (z.y > 0 || (z.vy && z.vy !== 0)) {
          z.vy = (z.vy || 0) - 18.0 * dt;
          z.y += z.vy * dt;
          if (z.y <= 0) {
            z.y = 0;
            z.vy = 0;
          }
        }

        // 2. Lateral ambush dash + weaving
        const targetX = z.targetX ?? 0;
        const dx = targetX - z.x;
        if (Math.abs(dx) > 0.15) {
          const lateralSpeed = Math.abs(z.x) > 7.5 ? z.speed * 3.2 : z.speed * 1.4;
          z.x += Math.sign(dx) * Math.min(Math.abs(dx), lateralSpeed * dt * staggerFactor);
        } else if (z.z < -3.5) {
          z.strafePhase = (z.strafePhase || 0) + dt * (z.type === 'fast' ? 3.2 : 1.8);
          z.x += Math.sin(z.strafePhase) * dt * (z.type === 'fast' ? 1.6 : 0.75) * staggerFactor;
        }

        // 3. Walk up to z = +1.4
        const attackZ = 1.4;
        if (z.z < attackZ) {
          const forwardFactor = Math.abs(z.x) > 9.0 ? 0.85 : 2.25;
          z.z += z.speed * dt * forwardFactor * staggerFactor;

          if (z.z > -4.0) {
            const maxCloseX = 2.1;
            if (Math.abs(z.x) > maxCloseX) {
              z.x += (Math.sign(z.x) * maxCloseX - z.x) * dt * 2.8;
            }
          }
          z.state = 'walking';
        } else {
          // Attacking & scratching the screen right in front of the player!
          z.y = 0;
          z.state = 'attacking';
          this.barricadeHp -= z.damage * dt;

          if (Math.random() < dt * 1.8) {
            // Also damage an active non-downed player and reset their combo
            const activePlayers = Array.from(this.players.values()).filter(
              (p) => p.isConnected && !p.isDowned
            );
            if (activePlayers.length > 0) {
              const victim =
                activePlayers[Math.floor(Math.random() * activePlayers.length)];
              victim.combo = 0;
              victim.multiplier = 1;
              victim.hp = Math.max(0, victim.hp - z.damage * 1.6);
              if (victim.hp <= 0 && !victim.isDowned) {
                victim.isDowned = true;
                victim.downedRemainingSec = COMBO_CONFIG.reviveWindowSec;
                this.broadcastCallback({
                  type: 'player_downed',
                  playerId: victim.id,
                  playerName: victim.name,
                });
              }
            }

            for (const p of this.players.values()) {
              this.directMessageCallback(p.id, { type: 'haptic', pattern: 'damage' });
            }
            this.broadcastCallback({
              type: 'barricade_damaged',
              currentHp: Math.max(0, this.barricadeHp),
              damage: z.damage,
            });
          }

          if (this.barricadeHp <= 0) {
            this.phase = 'GAME_OVER';
            return;
          }
        }
      }
    }

    // Check if wave cleared (ignore friendly civilians if any remain)
    const remainingHostiles = this.zombies.filter((z) => !z.isCivilian);
    if (this.nextWaveSpawnQueue.length === 0 && remainingHostiles.length === 0) {
      this.zombies = [];
      this.phase = 'WAVE_CLEARED';
      this.intermissionCountdown = 4.0;
    }
  }

  // Autonomous behavior for simulator bots (avoids shooting civilians, revives downed teammates)
  private updateBotPlayer(bot: PlayerInfo, dt: number) {
    // Priority 1: Revive a downed teammate!
    const downedTeammate = Array.from(this.players.values()).find(
      (p) => p.id !== bot.id && p.isDowned
    );
    if (downedTeammate) {
      const beacon = this.getDownedBeaconScreenPos(downedTeammate);
      bot.crosshair.x += (beacon.x - bot.crosshair.x) * dt * 6.0;
      bot.crosshair.y += (beacon.y - bot.crosshair.y) * dt * 6.0;
      if (Math.hypot(bot.crosshair.x - beacon.x, bot.crosshair.y - beacon.y) < 0.08) {
        this.handleShoot(bot.id);
      }
      return;
    }

    const target = this.zombies.find(
      (z) => !z.isCivilian && (z.state === 'walking' || z.state === 'attacking')
    );
    if (target) {
      const hitbox = ZOMBIE_HITBOXES[target.type] || ZOMBIE_HITBOXES.normal;
      const aimY = target.weakPoint?.active
        ? (target.y || 0) + target.weakPoint.offsetY * ZOMBIE_VISUAL_SCALE
        : (target.y || 0) +
          ((hitbox.bodyCapsule.bottomY + hitbox.bodyCapsule.topY) * 0.5) * ZOMBIE_VISUAL_SCALE;

      const screenPos = this.projectWorldToScreen(target.x, aimY, target.z);
      bot.crosshair.x += (screenPos.x - bot.crosshair.x) * dt * 4.5;
      bot.crosshair.y += (screenPos.y - bot.crosshair.y) * dt * 4.5;

      const dist = Math.hypot(bot.crosshair.x - screenPos.x, bot.crosshair.y - screenPos.y);
      if (dist < 0.08 && Math.random() < 0.18) {
        this.handleShoot(bot.id);
      }
    } else {
      bot.crosshair.x = 0.5 + Math.sin(Date.now() * 0.001 + bot.slot) * 0.22;
      bot.crosshair.y = 0.48 + Math.cos(Date.now() * 0.0015 + bot.slot) * 0.12;
    }
  }
}
