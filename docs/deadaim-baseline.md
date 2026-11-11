# DeadAim v1 Baseline Checklist & Behavior Audit

**Snapshot Date:** 2026-11-10  
**Backup Location:** `/backup/deadaim-v1/` (complete copy of project prior to any edits, excluding `node_modules`)

---

## 1. How to Start & Run DeadAim Today

| Command | Action |
| :--- | :--- |
| `npm start` / `npm run dev` | Runs `tsx server.ts` on `0.0.0.0:3000` (Express + `ws` WebSocket server + Vite SPA middleware in dev, or static `dist/` in prod). |
| `npm test` | Runs `tsx tests/server.test.ts` (18 automated test suites covering `GameEngine`, hitboxes, 3D projection, GLB headers, WAV headers, notification queues, and 30-zombie performance). |
| `npm run sim` | Runs `tsx scripts/simulator.ts` (connects 6 simulated phone controllers over WebSocket at 60Hz motion aim + periodic shooting/reloading). |
| `npm run build` | Runs `vite build` to output client bundle to `dist/`. |
| `npm run lint` | Runs `tsc --noEmit` to validate TypeScript types across client, server, shared, and tests. |

### URL Routes (`src/App.tsx` & `server.ts`)
- `/`, `/game`, or `?role=game` on desktop/TV browsers -> renders `<GameApp />` (TV 3D battlefield + HUD).
- `/controller` or `?role=controller` (or any mobile User-Agent on `/`) -> renders `<ControllerApp />` (Smartphone motion light-gun controller).
- Pressing `F2` on TV toggles the debug `[F2]` TV/Phone role switcher pill, HUD assist toggles, and `SimulatorControls` test deck.

---

## 2. All Screens & Game Phases

### TV Screens (`src/game/`)
1. **`LOBBY` (`LobbyView.tsx`)**:
   - Displays DeadAim Overdrive SVG marquee, 3-column glass layout:
     - Left: Phone Light-Gun QR Code (`/controller`), local/cloud URL, and `+1 Bot` / `Clear` wingman bot controls.
     - Center: Connected Light-Guns list (shows slot `1P..8P`, name, color, AI Wingman vs Phone Ready, ticket balance `🎟️`), and `START ARCADE STAGE` button.
     - Right: Top 5 All-Time High Scores leaderboard.
   - Live player calibration reticles float over the 3D background city scene in real time.
   - **Attract Mode**: Triggers after 30 seconds of inactivity (or clicking `Attract Demo`), cycling through Stage 1–3 previews and the Hall of Fame High Scores table with a flashing `FIRE TO JOIN · PRESS START` callout.
2. **`TUTORIAL` (`HudOverlay.tsx` + `GameEngine.ts`)**:
   - 7-second interactive calibration phase before Wave 1 with 3 stationary bonus targets (`z = -11`) and a `SKIP TUTORIAL & START WAVE 1` button.
3. **`COUNTDOWN` (`HudOverlay.tsx`)**:
   - 3-second wave countdown banner in the upper third of the screen.
4. **`PLAYING` (`ThreeScene.ts` + `HudOverlay.tsx`)**:
   - 3D scrolling stages (`STAGE 1: NEON DOWNTOWN`, `STAGE 2: BIO-LAB REACTOR`, `STAGE 3: CYBER CITADEL ROOFTOP`) with 1–8 foreground bottom-edge player turrets (`z = 3.25`), forcefield barricade (`z = -1.8`), 3D GLB zombies (`normal`, `fast`, `tank`, `boss`), friendly civilians (`DON'T SHOOT!`), floating weapon/power-up crates, and downed player revive beacons (`SHOOT TO REVIVE`).
   - Top HUD bar: Stage & Wave counter + active freeze/double-damage timers (left), 16-segment Forcefield HP bar (center), `[TAB]` Cabinet Quick Menu button (right), and dedicated Boss HP bar with 33%/66% phase markers when a Boss is active.
   - Bottom HUD bar: 1–8 player cards anchored above each player's 3D turret with slot badge, name, in-place hit-streak badge (capped at `8X MAX`), 6-digit score, current weapon & ammo readout, and turret weapon-pickup toasts.
5. **`WAVE_CLEARED` & `BONUS_ROUND` (`HudOverlay.tsx`)**:
   - Intermission countdown between waves; `BONUS_ROUND` spawns 6 moving bonus drones and 2 weapon crates (`shotgun`, `machine_gun`, `grenade_launcher`).
6. **`GAME_OVER` & `VICTORY` (`ScoreboardView.tsx`)**:
   - Displays Victory/Defeat header, MVP Top Arcade Gunner spotlight, squad totals (Team Score, Total Kills, Shots Fired, Accuracy %), per-player stats table, All-Time High Scores table, and `PLAY AGAIN (FREE PLAY)` button.
7. **`SettingsModal` (`SettingsModal.tsx`)**:
   - Sound Mixer sliders (Master, Music & Ambience, Effects, Zombie Voices & Announcer) + Mute (`Key M`) + Phone Speaker Hit-Confirmation Tick toggle.
   - Atmosphere & Gore Mode (`adult` vs `kids`) + Scare Intensity Level (`low`, `medium`, `high`).
   - Light-Gun Assist toggles (`autoFire`, `autoReload`, `unlimitedAmmo`).
   - 3D GLB Character Theme selector (`classic`, `cartoon`, `robot`).
   - Arcade Difficulty (`easy`, `normal`, `hard`) & Stages to Clear (`3`, `5`, `10`).
   - Post-Processing Graphics toggle (`high`, `low`).

### Phone Controller Screens (`src/controller/ControllerApp.tsx`)
1. **Onboarding / Pairing Screen (`!joined`)**:
   - Operative Call-Sign input (`deadaim_player_name`), 8-color Laser Sight picker (`deadaim_player_color`), Arcade Weapon Assist toggles, Flat-Phone Tilt Aiming guide, and `Activate Light-Gun & Sensors` button.
2. **Active Light-Gun HUD (`joined`)**:
   - Top bar: Player name, slot (`1P..8P`), ticket count (`🎟️`), ping (`ms`), `Locker` button, `Gyro`/`Touch` mode toggle, `Flat` center reset, `Hold` angle calibrate, and phone speaker hit-tick toggle.
   - Assist quick-toggle strip (`Auto-Fire`, `Auto-Reload`, `Unlimited`).
   - Custom SVG gun silhouette in player's equipped skin color + 4-weapon selector bar (`PISTOL`, `SHOTGUN`, `SMG`, `GRENADE`).
   - Center area: Flat-Phone Tilt Aim Radar (or thumb touch trackpad), Downed alert banner, and 3-Letter High-Score Initials entry box during `VICTORY`/`GAME_OVER`.
   - Bottom cluster: `Reload` button (plus physical shake/flick reload) and giant `FIRE` trigger button.
   - **Arcade Rewards Locker Modal**: Spend tickets (`🎟️`) to unlock & equip weapon skins, crosshairs, and zombie themes.

---

## 3. HTTP & WebSocket Protocol (`shared/types.ts`)

### HTTP Endpoints (`server.ts`)
- `GET /api/info`: Returns `ServerNetworkInfo` + `qrDataUrl`, `playerCount`, `phase`, `settings`.
- `GET /api/state`: Returns `{ world: GameWorldState }`.
- `POST /api/action`: Accepts `start_game`, `restart_game`, `update_settings`, `spawn_bots`, `remove_bots`, `trigger_review_scene` and returns `{ ok: true, world }`.

### WebSocket `/ws` Client -> Server (`ClientMessage`)
- `phone_join`: `{ type: 'phone_join', name: string, color?: string, reconnectToken?: string }`
- `aim`: `{ type: 'aim', x: number, y: number, pitch?: number, yaw?: number, roll?: number }`
- `shoot`: `{ type: 'shoot', timestamp?: number }`
- `reload`: `{ type: 'reload' }`
- `recenter`: `{ type: 'recenter' }`
- `switch_weapon`: `{ type: 'switch_weapon', weapon: WeaponType }`
- `submit_highscore`: `{ type: 'submit_highscore', initials: string }`
- `unlock_reward`: `{ type: 'unlock_reward', rewardId: string }`
- `equip_reward`: `{ type: 'equip_reward', rewardId: string }`
- `skip_tutorial`: `{ type: 'skip_tutorial' }`
- `update_player_options`: `{ type: 'update_player_options', autoFire?: boolean, autoReload?: boolean, unlimitedAmmo?: boolean }`
- `start_game`: `{ type: 'start_game' }`
- `restart_game`: `{ type: 'restart_game' }`
- `update_settings`: `{ type: 'update_settings', settings: Partial<GameSettings> }`
- `spawn_bots`: `{ type: 'spawn_bots', count: number }`
- `remove_bots`: `{ type: 'remove_bots' }`
- `trigger_review_scene`: `{ type: 'trigger_review_scene', stageIndex?: number }`
- `ping`: `{ type: 'ping', time: number }`

### WebSocket `/ws` Server -> Client (`ServerMessage`)
- `phone_joined`: `{ type: 'phone_joined', player: PlayerInfo, reconnectToken: string }`
- `lobby_update`: `{ type: 'lobby_update', players: PlayerInfo[], settings: GameSettings, phase: GamePhase }`
- `game_tick`: `{ type: 'game_tick', world: GameWorldState }` (broadcast at 30Hz)
- `haptic`: `{ type: 'haptic', pattern: HapticPatternType, headshot?: boolean }` (direct to shooter)
- `hit_event`: `{ type: 'hit_event', playerId, zombieId, zombieType, weapon, headshot, weakPointHit, damage, scoreAwarded, combo, multiplier, killed, isBossKill, position }`
- `coop_combo`: `{ type: 'coop_combo', playerIds, playerNames, bonusScore, position }`
- `civilian_hit`: `{ type: 'civilian_hit', playerId, playerName, penalty, position }`
- `player_downed`: `{ type: 'player_downed', playerId, playerName }`
- `player_revived`: `{ type: 'player_revived', playerId, reviverId, playerName, reviverName }`
- `boss_spawned`: `{ type: 'boss_spawned', zombieId, bossName, position }`
- `barricade_damaged`: `{ type: 'barricade_damaged', currentHp, damage }`
- `powerup_collected`: `{ type: 'powerup_collected', playerId, powerupType, weaponGranted }`
- `highscores_updated`: `{ type: 'highscores_updated', highScores: HighScoreEntry[] }`
- `pong`: `{ type: 'pong', time: number }`
- `error`: `{ type: 'error', message: string }`

---

## 4. Baseline Test & Simulator Results (Pre-Change)

### Automated Test Suite (`npm test`)
All **18 / 18** test suites in `tests/server.test.ts` passed with `0` failures:
1. `PASS: Player Join assigns sequential slots and unique tokens`
2. `PASS: Player keeps slot and stats upon reconnecting with token`
3. `PASS: Aim coordinates are clamped safely to viewport boundaries`
4. `PASS: Shooting depletes ammo, fires haptic, and respects reload cooldown`
5. `PASS: Difficulty settings and audio/scare settings update properly`
6. `PASS: Bot simulation spawns 6 simultaneous players for scale testing`
7. `PASS: 3D Camera projection correctly centers on target and zombie body without ground drift`
8. `PASS: Pointing at a zombie with Auto-Fire automatically shoots and Unlimited Ammo prevents depletion`
9. `PASS: ZOMBIE_HITBOXES accurately distinguish Head Sphere headshots from Body Capsule hits across all 4 zombie types`
10. `PASS: shared/themes.json defines GLB paths, scales, animations, and voiceSets, and all 12 GLB files have valid glTF v2 headers`
11. `PASS: shared/audio.json defines weapons, 3-4 zombie voice variations per state, 3 music layers + heartbeat, stingers & announcer WAVs`
12. `PASS: Combo counter scales multiplier up to 8x, resets on miss, and awards Co-Op Crossfire Bonus when 2 players hit same zombie`
13. `PASS: Civilians penalize shooter, downed players can be revived by teammates within 10s, mid-game drop-in works, and high scores save`
14. `PASS: 3 Stages map properly with Boss Weak-Point critical hits and players can unlock/equip rewards with tickets`
15. `PASS: Server Engine ticks 30 simultaneous zombies and 6 players in under 2ms per frame (>60 FPS server budget)` (`avg 0.189 ms/tick`)
16. `PASS: Phase 1 Regression: Hit detection results for a fixed set of aim points are 100% invariant across player slots 1..8 and independent of turret position`
17. `PASS: Phase 2: Central Notification Queue (1 banner at a time, drops >2s stale banners, merges rapid target popups, caps streak at MAX)`
18. `PASS: Phases 3, 5, 6 & 7: Auto-Fire disabled by default, Stage 2 Bio-Lab config-driven props, and F4 deterministic review scene`

### 6-Phone Simulator (`npm run sim`)
Connected 6 simulated phones (`Phone-Gun-01` through `Phone-Gun-06`) over `ws://localhost:3000/ws`, streamed 60Hz `aim` messages, and fired/reloaded weapons with all 6 sockets reporting `ReadyState=ACTIVE`.
