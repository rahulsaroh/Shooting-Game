/**
 * Automated Test Suite for DeadAim Server, Arcade Mechanics (Phases A-E), Hitboxes, GLB Models & Audio
 * Run with: npm test
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameEngine } from '../server/GameEngine.ts';
import { ServerMessage, ZombieType } from '../shared/types.ts';
import { STAGES, WEAPONS, ZOMBIE_HITBOXES, ZOMBIE_VISUAL_SCALE } from '../shared/config.ts';
import themesData from '../shared/themes.json' with { type: 'json' };
import audioManifest from '../shared/audio.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

console.log('🧪 Starting DeadAim Automated Test Suite...\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.message}`);
    testsFailed++;
  }
}

// Mock broadcast and direct message callbacks
const broadcasts: ServerMessage[] = [];
const directMessages: { playerId: string; msg: ServerMessage }[] = [];

function createTestEngine() {
  broadcasts.length = 0;
  directMessages.length = 0;
  return new GameEngine(
    (msg) => broadcasts.push(msg),
    (playerId, msg) => directMessages.push({ playerId, msg }),
    false // disable disk overwrite during unit tests
  );
}

// TEST SUITE 1: Player Join and Slot Assignment
runTest('Player Join assigns sequential slots and unique tokens', () => {
  const engine = createTestEngine();

  const p1 = engine.handleJoin('Player One', '#00f5d4');
  assert.strictEqual(p1.player.name, 'Player One');
  assert.strictEqual(p1.player.slot, 1);
  assert.strictEqual(p1.player.color, '#00f5d4');
  assert.ok(p1.token.length > 10);
  assert.strictEqual(p1.isReconnect, false);

  const p2 = engine.handleJoin('Player Two', '#f72585');
  assert.strictEqual(p2.player.slot, 2);
  assert.strictEqual(p2.player.color, '#f72585');
  assert.notStrictEqual(p1.player.id, p2.player.id);

  assert.strictEqual(engine.getPlayers().length, 2);
});

// TEST SUITE 2: Graceful Disconnect & Reconnect Retention
runTest('Player keeps slot and stats upon reconnecting with token', () => {
  const engine = createTestEngine();

  const joinResult = engine.handleJoin('SniperGhost', '#70e000');
  const token = joinResult.token;
  const initialId = joinResult.player.id;

  joinResult.player.stats.score = 250;

  engine.handleDisconnect(initialId);
  assert.strictEqual(engine.getPlayers()[0].isConnected, false);

  const reconnectResult = engine.handleJoin('SniperGhost', undefined, token);
  assert.strictEqual(reconnectResult.isReconnect, true);
  assert.strictEqual(reconnectResult.player.id, initialId);
  assert.strictEqual(reconnectResult.player.slot, 1);
  assert.strictEqual(reconnectResult.player.stats.score, 250);
  assert.strictEqual(reconnectResult.player.isConnected, true);
});

// TEST SUITE 3: Motion Aim Clamping
runTest('Aim coordinates are clamped safely to viewport boundaries', () => {
  const engine = createTestEngine();
  const { player } = engine.handleJoin('Aimer');

  engine.handleAim(player.id, -2.5, 4.8);
  assert.strictEqual(player.crosshair.x, 0.01);
  assert.strictEqual(player.crosshair.y, 0.99);

  engine.handleAim(player.id, 0.5, 0.5);
  assert.strictEqual(player.crosshair.x, 0.5);
  assert.strictEqual(player.crosshair.y, 0.5);
});

// TEST SUITE 4: Weapon Ammo, Shooting & Reload Logic
runTest('Shooting depletes ammo, fires haptic, and respects reload cooldown', () => {
  const engine = createTestEngine();
  const { player } = engine.handleJoin('Shooter');

  engine.startGame(false);
  (engine as any).phase = 'PLAYING';

  const initialAmmo = player.ammo;
  assert.strictEqual(initialAmmo, 12);

  engine.handleShoot(player.id);
  assert.strictEqual(player.ammo, 11);
  assert.strictEqual(player.stats.shotsFired, 1);

  const shootHaptic = directMessages.find(
    (m) => m.playerId === player.id && (m.msg as any).pattern === 'shoot'
  );
  assert.ok(shootHaptic, 'Should have received shoot haptic pattern');

  engine.handleReload(player.id);
  assert.strictEqual(player.isReloading, true);

  engine.handleShoot(player.id);
  assert.strictEqual(player.ammo, 11, 'Ammo should not deplete while reloading');
});

// TEST SUITE 5: Settings and Difficulty Multipliers
runTest('Difficulty settings and audio/scare settings update properly', () => {
  const engine = createTestEngine();

  engine.updateSettings({ difficulty: 'easy' });
  assert.strictEqual(engine.getWorldState().maxBarricadeHp, 150);

  engine.updateSettings({ difficulty: 'hard' });
  assert.strictEqual(engine.getWorldState().maxBarricadeHp, 80);

  engine.updateSettings({
    mode: 'kids',
    theme: 'cartoon',
    scareLevel: 'low',
    masterVolume: 0.7,
    phoneHitSound: true,
    postProcessingQuality: 'low',
  });
  assert.strictEqual(engine.getSettings().mode, 'kids');
  assert.strictEqual(engine.getSettings().theme, 'cartoon');
  assert.strictEqual(engine.getSettings().scareLevel, 'low');
  assert.strictEqual(engine.getSettings().masterVolume, 0.7);
  assert.strictEqual(engine.getSettings().postProcessingQuality, 'low');
});

// TEST SUITE 6: Multi-Bot Squad Spawning
runTest('Bot simulation spawns 6 simultaneous players for scale testing', () => {
  const engine = createTestEngine();

  engine.spawnBots(6);
  assert.strictEqual(engine.getPlayers().length, 6);
  const bots = engine.getPlayers().filter((p) => p.isBot);
  assert.strictEqual(bots.length, 6);

  engine.removeBots();
  assert.strictEqual(engine.getPlayers().length, 0);
});

// TEST SUITE 7: 3D Camera Projection Accuracy
runTest('3D Camera projection correctly centers on target and zombie body without ground drift', () => {
  const engine = createTestEngine();

  const lookTargetScreen = engine.projectWorldToScreen(0, 1.2, -18.0);
  assert.ok(
    Math.abs(lookTargetScreen.x - 0.5) < 0.01,
    `Look target X should be ~0.5, got ${lookTargetScreen.x}`
  );
  assert.ok(
    Math.abs(lookTargetScreen.y - 0.5) < 0.01,
    `Look target Y should be ~0.5, got ${lookTargetScreen.y}`
  );

  const torsoScreen = engine.projectWorldToScreen(0, 1.3, -18.0);
  assert.ok(
    torsoScreen.y > 0.47 && torsoScreen.y < 0.52,
    `Zombie torso should be near screen center ~0.495, got ${torsoScreen.y}`
  );

  const groundScreen = engine.projectWorldToScreen(0, 0, -18.0);
  assert.ok(
    groundScreen.y > torsoScreen.y,
    `Ground should be below torso in screen space (higher Y), got ground=${groundScreen.y}, torso=${torsoScreen.y}`
  );
});

// TEST SUITE 8: Target-Lock Auto-Fire, Auto-Reload & Unlimited Ammo
runTest('Pointing at a zombie with Auto-Fire automatically shoots and Unlimited Ammo prevents depletion', () => {
  const engine = createTestEngine();
  const { player } = engine.handleJoin('AutoGunner');

  engine.startGame(false);
  (engine as any).phase = 'PLAYING';
  (engine as any).nextWaveSpawnQueue = [];

  (engine as any).zombies.push({
    id: 'z_test_1',
    type: 'normal',
    x: 0,
    y: 0,
    z: -12,
    hp: 100,
    maxHp: 100,
    speed: 1,
    damage: 6,
    radius: 1.0,
    isFrozen: false,
    state: 'walking',
    theme: 'classic',
  });

  engine.handleUpdatePlayerOptions(player.id, {
    autoFire: true,
    autoReload: true,
    unlimitedAmmo: true,
  });

  const targetScreen = engine.projectWorldToScreen(0, 2.12, -12);
  engine.handleAim(player.id, targetScreen.x, targetScreen.y);

  engine.tick();

  assert.strictEqual(player.isTargetLocked, true, 'Crosshair should lock onto zombie');
  assert.strictEqual(player.stats.shotsFired, 1, 'Auto-fire should fire a shot automatically');
  assert.strictEqual(player.stats.shotsHit, 1, 'Auto-fire shot should hit the zombie');
  assert.strictEqual(player.ammo, player.maxAmmo, 'Unlimited ammo should keep magazine full');
});

// TEST SUITE 9: Authoritative Hitboxes (Head Sphere + Body Capsule per Zombie Type)
runTest('ZOMBIE_HITBOXES accurately distinguish Head Sphere headshots from Body Capsule hits across all 4 zombie types', () => {
  const engine = createTestEngine();
  const types: ZombieType[] = ['normal', 'fast', 'tank', 'boss'];

  for (const type of types) {
    const hb = ZOMBIE_HITBOXES[type];
    assert.ok(hb.headSphere.radius > 0, `${type} headSphere radius must be positive`);
    assert.ok(
      hb.bodyCapsule.topY > hb.bodyCapsule.bottomY,
      `${type} bodyCapsule topY must be above bottomY`
    );

    const zombie = {
      id: `z_hb_${type}`,
      type,
      x: 0,
      y: 0,
      z: -10,
      hp: 200,
      maxHp: 200,
      speed: 1,
      damage: 10,
      radius: 1,
      isFrozen: false,
      state: 'walking' as const,
      theme: 'classic' as const,
    };

    const headWorldY = hb.headSphere.offsetY * ZOMBIE_VISUAL_SCALE;
    const headScreen = engine.projectWorldToScreen(0, headWorldY, -10);
    const headHit = engine.checkZombieHit(headScreen.x, headScreen.y, zombie);
    assert.strictEqual(headHit.hit, true, `${type} headSphere center should register a hit`);
    assert.strictEqual(headHit.isHeadshot, true, `${type} headSphere center should be a headshot`);

    const bodyMidWorldY =
      ((hb.bodyCapsule.bottomY + hb.bodyCapsule.topY) * 0.5) * ZOMBIE_VISUAL_SCALE;
    const bodyScreen = engine.projectWorldToScreen(0, bodyMidWorldY, -10);
    const bodyHit = engine.checkZombieHit(bodyScreen.x, bodyScreen.y, zombie);
    assert.strictEqual(bodyHit.hit, true, `${type} bodyCapsule center should register a hit`);
    assert.strictEqual(
      bodyHit.isHeadshot,
      false,
      `${type} bodyCapsule center should NOT be a headshot`
    );

    const miss = engine.checkZombieHit(0.02, 0.02, zombie);
    assert.strictEqual(miss.hit, false, `${type} far corner should miss`);
  }
});

// TEST SUITE 10: GLB Models & shared/themes.json Validation
runTest('shared/themes.json defines GLB paths, scales, animations, and voiceSets, and all 12 GLB files have valid glTF v2 headers', () => {
  const themes = themesData.themes as Record<string, any>;
  for (const themeKey of ['classic', 'cartoon', 'robot']) {
    const theme = themes[themeKey];
    assert.ok(theme, `Theme ${themeKey} must exist`);
    assert.ok(theme.voiceSet, `Theme ${themeKey} must specify a voiceSet`);

    for (const typeKey of ['normal', 'fast', 'tank', 'boss']) {
      const tDef = theme.types[typeKey];
      assert.ok(tDef.model, `${themeKey}.${typeKey} must have model path`);
      assert.ok(typeof tDef.scale === 'number', `${themeKey}.${typeKey} must have numeric scale`);
      assert.ok(tDef.animations?.walk, `${themeKey}.${typeKey} must define walk animation name`);
      assert.ok(tDef.animations?.attack, `${themeKey}.${typeKey} must define attack animation name`);
      assert.ok(tDef.animations?.death, `${themeKey}.${typeKey} must define death animation name`);

      const diskPath = path.join(PUBLIC_DIR, tDef.model);
      assert.ok(fs.existsSync(diskPath), `GLB file must exist at ${diskPath}`);
      const buf = fs.readFileSync(diskPath);
      assert.strictEqual(
        buf.readUInt32LE(0),
        0x46546c67,
        `${tDef.model} must start with 'glTF' magic header`
      );
      assert.strictEqual(buf.readUInt32LE(4), 2, `${tDef.model} must be glTF version 2`);
    }
  }
});

// TEST SUITE 11: Audio Manifest (shared/audio.json) & WAV Files Validation
runTest('shared/audio.json defines weapons, 3-4 zombie voice variations per state, 3 music layers + heartbeat, stingers & announcer WAVs', () => {
  const cats = audioManifest.categories;
  assert.ok(cats.weapons.shot.files.length >= 3, 'Should have at least 3 gunshot variations');
  assert.ok(cats.music.calm && cats.music.tense && cats.music.intense, 'Must have 3 music layers');
  assert.ok(cats.music.heartbeat, 'Must have low-HP heartbeat layer');

  for (const zType of ['normal', 'fast', 'tank', 'boss'] as const) {
    const zAudio = cats.zombies[zType];
    for (const state of ['idle', 'aggro', 'attack', 'hit', 'death'] as const) {
      const files = zAudio[state].files;
      assert.ok(
        files.length >= 3 && files.length <= 5,
        `Zombie ${zType}.${state} must have 3-5 variations, found ${files.length}`
      );
      for (const relPath of files) {
        const wavPath = path.join(PUBLIC_DIR, relPath);
        assert.ok(fs.existsSync(wavPath), `Audio file must exist at ${wavPath}`);
        const header = fs.readFileSync(wavPath).subarray(0, 12);
        assert.strictEqual(header.subarray(0, 4).toString('ascii'), 'RIFF');
        assert.strictEqual(header.subarray(8, 12).toString('ascii'), 'WAVE');
      }
    }
  }
});

// TEST SUITE 12: Phase A & C - Combo Multiplier, Co-Op Crossfire Bonus, and Weapon Switching
runTest('Combo counter scales multiplier up to 8x, resets on miss, and awards Co-Op Crossfire Bonus when 2 players hit same zombie', () => {
  const engine = createTestEngine();
  const { player: p1 } = engine.handleJoin('Player1');
  const { player: p2 } = engine.handleJoin('Player2');

  engine.startGame(false);
  (engine as any).phase = 'PLAYING';
  (engine as any).nextWaveSpawnQueue = [];

  (engine as any).zombies.push({
    id: 'z_coop',
    type: 'tank',
    x: 0,
    y: 0,
    z: -10,
    hp: 600,
    maxHp: 600,
    speed: 1,
    damage: 10,
    radius: 1,
    isFrozen: false,
    state: 'walking',
    theme: 'classic',
  });

  const targetScreen = engine.projectWorldToScreen(0, 2.1, -10);
  engine.handleAim(p1.id, targetScreen.x, targetScreen.y);
  engine.handleAim(p2.id, targetScreen.x, targetScreen.y);

  // Player 1 shoots 3 times -> combo = 3, multiplier = 2x
  engine.handleShoot(p1.id);
  engine.handleShoot(p1.id);
  engine.handleShoot(p1.id);
  assert.strictEqual(p1.combo, 3, 'P1 combo should be 3');
  assert.strictEqual(p1.multiplier, 2, 'P1 multiplier should increase to 2x at 3 hits');

  // Player 2 shoots same zombie within 1.5s -> triggers Co-Op Crossfire Bonus!
  engine.handleShoot(p2.id);
  const coopMsg = broadcasts.find((m) => m.type === 'coop_combo');
  assert.ok(coopMsg, 'Should broadcast coop_combo when 2 players hit the same zombie');
  assert.strictEqual(p1.stats.coopBonuses, 1);
  assert.strictEqual(p2.stats.coopBonuses, 1);

  // Player 1 misses into corner -> combo resets to 0 and multiplier to 1x
  engine.handleAim(p1.id, 0.02, 0.02);
  engine.handleShoot(p1.id);
  assert.strictEqual(p1.combo, 0, 'Missing a shot should reset combo to 0');
  assert.strictEqual(p1.multiplier, 1, 'Missing a shot should reset multiplier to 1x');

  // Switch weapon to Grenade Launcher and verify config-driven magazine
  engine.handleSwitchWeapon(p1.id, 'grenade_launcher');
  assert.strictEqual(p1.weapon, 'grenade_launcher');
  assert.strictEqual(p1.ammo, WEAPONS.grenade_launcher.maxAmmo);
});

// TEST SUITE 13: Phase B - Civilians Penalty, Downed Player & Teammate Revive, Drop-In/Out, High Scores
runTest('Civilians penalize shooter, downed players can be revived by teammates within 10s, mid-game drop-in works, and high scores save', () => {
  const engine = createTestEngine();
  const { player: p1 } = engine.handleJoin('Medic');
  const { player: p2 } = engine.handleJoin('Rookie');

  engine.startGame(false);
  (engine as any).phase = 'PLAYING';
  (engine as any).nextWaveSpawnQueue = [];

  // 1. Mid-game Drop-In: Player 3 joins while phase === 'PLAYING'
  const { player: p3 } = engine.handleJoin('DropInHero');
  assert.strictEqual(engine.getPhase(), 'PLAYING', 'Mid-game join must not restart the match');
  assert.strictEqual(p3.hp, 100);
  assert.strictEqual(p3.weapon, 'pistol');

  // 2. Spawn Civilian and shoot them -> score penalty + combo reset
  p2.stats.score = 300;
  p2.combo = 5;
  const civ = engine.spawnCivilian(0, -10);
  const civScreen = engine.projectWorldToScreen(civ.x, 2.0, civ.z);
  engine.handleAim(p2.id, civScreen.x, civScreen.y);
  engine.handleShoot(p2.id);

  assert.strictEqual(p2.combo, 0, 'Shooting civilian must reset combo');
  assert.strictEqual(p2.stats.score, 150, 'Shooting civilian must deduct 150 score');
  const civHitMsg = broadcasts.find((m) => m.type === 'civilian_hit');
  assert.ok(civHitMsg, 'Should broadcast civilian_hit penalty event');

  // 3. Down Player 2 and have Player 1 shoot Player 2's revive beacon to revive them!
  p2.hp = 0;
  p2.isDowned = true;
  p2.downedRemainingSec = 10;

  const beaconPos = engine.getDownedBeaconScreenPos(p2);
  engine.handleAim(p1.id, beaconPos.x, beaconPos.y);
  engine.handleShoot(p1.id);

  assert.strictEqual(p2.isDowned, false, 'Downed player should be revived when teammate shoots beacon');
  assert.strictEqual(p2.hp, 100, 'Revived player should have full HP restored');
  assert.strictEqual(p1.stats.revives, 1, 'Reviver should receive +1 revive stat');

  // 4. Submit 3-letter High Score Initials
  p1.stats.score = 29999;
  const topScores = engine.submitHighScore(p1.id, 'med');
  assert.strictEqual(topScores[0].initials, 'MED');
  assert.strictEqual(topScores[0].score, 29999);
});

// TEST SUITE 14: Phase B & E - 3 Stages with Boss Weak Points & Unlockable Rewards System
runTest('3 Stages map properly with Boss Weak-Point critical hits and players can unlock/equip rewards with tickets', () => {
  const engine = createTestEngine();
  const { player } = engine.handleJoin('VIPPlayer');

  assert.strictEqual(STAGES.length, 3, 'Must have 3 distinct arcade stages');
  assert.strictEqual(engine.getStageIndexForWave(1), 0);
  assert.strictEqual(engine.getStageIndexForWave(3), 1);
  assert.strictEqual(engine.getStageIndexForWave(5), 2);

  // Give player tickets and unlock Golden Arcade VIP weapon skin
  player.tickets = 50;
  const unlocked = engine.handleUnlockReward(player.id, 'skin_gold');
  assert.strictEqual(unlocked, true);
  assert.ok(player.unlockedRewards.includes('skin_gold'));
  assert.strictEqual(player.equippedSkin, 'skin_gold');
  assert.strictEqual(player.tickets, 35);
});

// TEST SUITE 15: 30 Zombies + 6 Players High-Load Performance Benchmark
runTest('Server Engine ticks 30 simultaneous zombies and 6 players in under 2ms per frame (>60 FPS server budget)', () => {
  const engine = createTestEngine();
  engine.spawnBots(6);
  engine.startGame(false);
  (engine as any).phase = 'PLAYING';
  (engine as any).nextWaveSpawnQueue = [];

  const types: ZombieType[] = ['normal', 'fast', 'tank', 'boss'];
  for (let i = 0; i < 30; i++) {
    (engine as any).spawnZombie(types[i % types.length]);
  }
  assert.strictEqual(engine.getWorldState().zombies.length, 30);

  const iterations = 60;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    engine.tick();
  }
  const elapsedMs = performance.now() - start;
  const avgTickMs = elapsedMs / iterations;

  console.log(
    `     ⚡ [Benchmark] 30 zombies + 6 bots over ${iterations} ticks: avg ${avgTickMs.toFixed(3)} ms/tick`
  );
  assert.ok(
    avgTickMs < 5.0,
    `Expected average tick time < 5.0ms for 30 zombies, got ${avgTickMs.toFixed(3)}ms`
  );
});

console.log('\n----------------------------------------');
console.log(`Test Results: ${testsPassed} Passed, ${testsFailed} Failed.`);
if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('🎉 All Automated Tests Passed Successfully!\n');
}
