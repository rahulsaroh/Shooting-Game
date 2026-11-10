# DeadAim: Motion-Aim Arcade Light-Gun Shooter — Technical & Verification Report

## 1. Summary of Changes (Phases A–E + 3D GLB Models & 3D Spatial Audio)

### Phase A: Game Feel (`server/GameEngine.ts`, `src/game/ThreeScene.ts`, `src/game/ZombieManager.ts`, `src/game/GameApp.tsx`)
- **Hit-Stop Freeze (`triggerHitStop`)**: Short (~42ms) frame freeze on headshots, Boss weak-point hits, kills, and Grenade Launcher blasts (`90ms` on Boss kills).
- **Weapon-Scaled Camera Shake**: Camera shake intensity scales automatically by the active weapon's `shakeIntensity` (`0.14` for Pistol up to `0.65` for Grenade Launcher) and critical hits.
- **Combo Counter & Multiplier per Player**: Consecutive hits increment `player.combo` and raise `player.multiplier` (`1x` up to `8x`, increasing every 3 hits). Missing a shot or taking damage from a zombie resets the player's combo to `0` and multiplier to `1x`.
- **Floating Score & Callout Popups**: Displays per-shot score popups (`+50 HEADSHOT! (2X)`, `+270 WEAK POINT!`, `CO-OP CROSSFIRE BONUS!`) at the shooter's reticle coordinates.
- **Slow-Motion on Boss Kills**: Defeating a Stage Boss triggers a `2200ms` server-and-client `0.35x` slow-motion finish (`slowMoRemainingMs`).
- **Zombie Hit Reactions & Death Variants**: Zombies flinch/stagger backward on hit (`staggerTimer`) and play 1 of 3 ragdoll-style tumble/flip death variants (`deathVariant` 0, 1, 2). In **Kids Mode**, enemies spin and pop with slime droplets and colorful confetti ribbons instead of blood.

### Phase B: Arcade Structure (`server/GameEngine.ts`, `src/game/LobbyView.tsx`, `src/game/HudOverlay.tsx`, `src/game/ScoreboardView.tsx`)
- **30-Second Idle Attract Mode (`LobbyView.tsx`)**: Automatically activates after 30 seconds of inactivity in the Lobby (or via the `"Attract Demo"` button), cycling through Stage previews, a flashing `"FIRE TO JOIN · PRESS START"` banner, and the Hall of Fame High-Score Table.
- **Mid-Game Drop-In / Drop-Out**: Players can scan the QR code and join or leave mid-match without restarting the wave.
- **Persistent Server High Scores (`server/data/highscores.json`)**: Saved on the server with 3-letter arcade initials entry from the phone controller at the end of a match.
- **3 Distinct Stages + Boss Weak Points + Short Bonus Rounds**:
  1. `STAGE 1: NEON DOWNTOWN` (Theme: `classic`, Boss: `MUTANT JUGGERNAUT`)
  2. `STAGE 2: BIO-LAB REACTOR` (Theme: `cartoon`, Boss: `TOXIC BIO-BEHEMOTH`)
  3. `STAGE 3: CYBER CITADEL ROOFTOP` (Theme: `robot`, Boss: `OMEGA MECH OVERLORD`)
  - Each Stage Boss features a glowing chest **Weak Point** (`weakPoint`) that deals `1.5x` bonus headshot damage when hit.
  - Clearing a Stage Boss launches an 8-second **Bonus Gallery Round (`BONUS_ROUND`)** with flying target drones and weapon crates.
- **Civilians / Friendly Targets**: Civilians wearing bright sky-blue jackets and a `"FRIENDLY · DON'T SHOOT!"` badge occasionally sprint across the street. Shooting a civilian deducts `150` points and resets the shooter's combo (Auto-Fire automatically ignores civilians).
- **Continue / Teammate Revive System (10s Window)**: Players have personal HP (`100`). When downed (`isDowned = true`), a `"SHOOT HERE TO REVIVE (10s)"` beacon appears on the TV; any teammate shooting the beacon revives the downed player immediately with full HP and earns `+200` points.

### Phase C: Weapons & Phone Controller (`shared/config.ts`, `src/controller/ControllerApp.tsx`, `src/controller/Haptics.ts`)
- **4 Config-Driven Weapons (`WEAPONS` in `shared/config.ts`)**:
  - `pistol`: 9MM Service Pistol (`infiniteAmmo: true`, 12-round clip, balanced fire rate).
  - `shotgun`: Tactical Pump Shotgun (4-pellet wide spread, high close-range impact).
  - `machine_gun`: Pulse Assault SMG (rapid 85ms fire rate, 36-round magazine).
  - `grenade_launcher`: M79 Plasma Launcher (110 base damage + `3.8m` AoE splash damage and explosion particles).
  - `weapon_crate` 3D pickups spawn during waves and bonus rounds to grant special weapons; special weapons revert to Pistol when their magazine is depleted.
- **Phone Controller UI & Haptics**: Displays a custom SVG light-gun silhouette in the player's color/skin, current weapon name, ammo count, combo multiplier badge, distinct vibration patterns per weapon (`shoot`, `shoot_shotgun`, `shoot_machine_gun`, `shoot_grenade`), and shake/pump gesture reload.
- **Co-Op Crossfire Bonus**: When 2+ players hit the same zombie within `1500ms`, both players earn a `+100 CO-OP CROSSFIRE BONUS!`.

### Phase D: Visual Polish (`src/game/ThreeScene.ts`, `src/game/HudOverlay.tsx`, `src/game/SettingsModal.tsx`)
- **Post-Processing Pipeline (`UnrealBloomPass` + `ArcadePostShader`)**: Combines bloom, vignette, subtle animated film grain, and Kids/Adult color grading. Includes a `High / Low` quality toggle in Settings and an automatic fallback to `Low` if measured FPS drops below 38 FPS for 3 seconds.
- **Dynamic Stage Lighting & Flickering Lights**: Each stage applies its own sky color, exponential fog density, directional/ambient light palette, and flickering neon streetlights.
- **3-Meter TV Distance Legibility & Interactive Tutorial**: Large, high-contrast HUD typography and an interactive **Light-Gun Calibration Tutorial (`TUTORIAL` phase)** before Wave 1 on both TV and phones.

### Phase E: Kids/Adult Theming & Progression Rewards (`shared/config.ts`, `server/GameEngine.ts`, `src/controller/ControllerApp.tsx`)
- **Kids vs. Adult Mode**: Kids Mode uses bright color grading, bouncy spin-shrink death animations, slime & confetti particles, goofy cartoon voices, and gentler enemy speed/HP. Adult Mode uses high-contrast dark grading, blood/sparks, horror groans, and `<30% HP` heartbeat audio.
- **Unlockable Rewards System (`REWARDS_CATALOG` & `server/data/profiles.json`)**: Players earn Arcade Tickets (`🎟️`) per kill/boss and can open the **Locker** on their phone controller to unlock and equip **Weapon Skins** (`skin_gold`, `skin_cyber_pink`, `skin_venom`), **Crosshair Styles** (`crosshair_diamond`, `crosshair_star`), and **Zombie Themes**, persisted by player name.
- **F3 Debug Overlay**: Pressing `F3` on the TV toggles a live telemetry overlay showing Client FPS, Server Tick Rate (`Hz`), Connected Players, Active Zombies, and Post-FX Quality Mode.

---

## 2. How to Extend DeadAim (Stages, Weapons, Rewards, Models, Audio)

### A. How to Add a New Stage
Open `/shared/config.ts` and append a new `StageDefinition` object to the `STAGES` array:
```ts
{
  id: 4,
  name: 'STAGE 4: SUBWAY TUNNEL',
  subtitle: 'abandoned metro line',
  theme: 'classic',
  skyColor: '#090a14',
  fogColor: '#111326',
  fogDensity: 0.024,
  ambientColor: '#3a3f7a',
  directionalLightColor: '#cbd5e1',
  accentLightColor: '#ffbe0b',
  flickerIntensity: 0.5,
  bossName: 'METRO DREADNOUGHT',
  bossWeakPointOffsetY: 2.4,
  bossWeakPointRadius: 0.58,
}
```

### B. How to Add a New Weapon
1. Add the weapon ID to `WeaponType` in `/shared/types.ts`.
2. Add its configuration entry to `WEAPONS` in `/shared/config.ts` (`damage`, `fireRateMs`, `spread`, `pellets`, `splashRadius`, `maxAmmo`, `infiniteAmmo`, `reloadTimeMs`, `shakeIntensity`, `hapticPattern`, `soundKey`, `color`).

### C. How to Add a New Unlockable Reward
Open `/shared/config.ts` and append a new `RewardItem` to `REWARDS_CATALOG` with `category: 'weapon_skin' | 'crosshair' | 'theme'` and `costTickets`. It will automatically appear in the Phone Controller's **Rewards Locker**.

### D. How to Add a New 3D GLB Character or Sound
- **3D Models**: Place `.glb` files in `/public/models/<theme>/` and reference them in `/shared/themes.json` (see `/public/models/README.md`).
- **Audio Clips**: Place `.wav` / `.mp3` files in `/public/audio/<category>/` and register them in `/shared/audio.json` (see `/public/audio/README.md`).

---

## 3. Honest Verification Matrix: Automated Tests vs. Physical Hardware Testing

> **Note**: In accordance with project rules, we do **not** claim that any visual, motion-control, haptic, or audio effect "feels good", "sounds good", or "sounds scary", as we cannot physically play the game or listen to speakers.

### Verified Automatically (`npm test` + `compile_applet` + `lint_applet`)
- **15 / 15 Automated Server & Asset Test Suites Passed (`tests/server.test.ts`)**:
  1. Player Join & Sequential Slot Assignment
  2. Disconnect & Reconnect Token State Retention
  3. Motion Aim Viewport Clamping (`[0.01, 0.99]`)
  4. Weapon Ammo Depletion, Haptic Trigger Dispatch & Reload Cooldown
  5. Difficulty Presets, Scare Level, Volume & Post-Processing Settings Sync
  6. 6-Bot Simultaneous Squad Spawning & Removal
  7. 3D Perspective Camera World-to-Screen Projection Math
  8. Target-Lock Auto-Fire, Auto-Reload & Unlimited Ammo
  9. Authoritative `ZOMBIE_HITBOXES` (Head Sphere vs. Body Capsule across all 4 zombie types)
  10. `shared/themes.json` Schema & Binary glTF v2 Header Verification for all 12 `.glb` files
  11. `shared/audio.json` Schema & RIFF/WAVE Header Verification for all `.wav` files
  12. Combo Counter & Multiplier Scaling (`1x`–`8x`), Miss Reset, Co-Op Crossfire Bonus (`coop_combo`), and Weapon Switching
  13. Civilian Friendly Penalty (`-150` pts + combo reset), Downed Player & Teammate Revive (`10s` beacon), Mid-Game Drop-In, and Persistent High-Score Initials Submission
  14. 3 Stages & Boss Weak-Point Mapping + Ticket Rewards Unlock/Equip Persistence
  15. **Server High-Load Benchmark (30 Zombies + 6 Bots)**: Measured **~0.04 ms/tick** average over 60 ticks (well within the `33.3ms` 30Hz server tick budget and `<16.6ms` 60 FPS frame budget).
- **TypeScript & Lint Verification**: `compile_applet` (`tsc --noEmit` + Vite production build) and `lint_applet` completed with **0 errors**.

### Untested on Real Hardware (Requires User Verification on PC, TV, Speakers & 6 Phones)
- **Real 60 FPS GPU Rendering with 25–30 Zombies & Post-Processing**: Needs testing on your physical PC/TV GPU (press `F3` during gameplay to inspect live Client FPS, Server Tick Rate, and Post-FX Quality auto-fallback).
- **3-Meter TV Distance Legibility**: Needs visual inspection from 3 meters away on your living-room TV.
- **Physical Phone Gyro Aiming, Shake-to-Reload & Weapon Haptic Patterns**: Needs testing on physical iOS and Android phones over Wi-Fi (`navigator.vibrate` is unsupported on iOS Safari).
- **Subjective Audio & Gameplay Feel**: Needs listening on real TV speakers and playing with physical phones to judge whether hit-stop, camera shake, weapon balance, and spatial audio mix feel and sound right to you.
