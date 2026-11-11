# DeadAim TV UI & Visual Review Report (`REPORT-UI-FIX.md`)

## Backup Confirmation
Before modifying any files, a full pre-change archive of the project was saved to:
- `/tmp/deadaim-backup-pre-phase1.tar.gz`

---

## Summary of Completed Phases (Phases 1–7)

### Phase 1: Foreground Player Turrets at Bottom Edge of Screen
- **Bottom-Edge Foreground Placement (`src/game/ThreeScene.ts`, `src/game/HudOverlay.tsx`)**:
  - Moved all player turrets off the middle barricade (`z = -1.8`) to the bottom foreground edge (`z = 3.25` in world space, `normY = 0.90` in screen space), evenly spaced across the bottom for **1 to 8 players** (`getTurretScreenX(index, count)`).
  - Kept the defense barricade at `z = -1.8` where zombies attack, completely unoccluded by player turrets.
- **Visual-Only Smooth Aiming, Recoil & Muzzle Flash**:
  - Each turret is a visual-only 3D element in its player's color that smoothly rotates/tilts (`Quaternion.slerp`) toward the player's crosshair aim point.
  - Added barrel kickback recoil animation and a 3D multi-mesh muzzle flash (`ConeGeometry` + core sphere) when firing.
- **Short Upward Shot Tracers (`src/game/ParticleSystem.ts`)**:
  - Replaced long full-screen beams with short upward tracers (`0.12s` / `120 ms` duration) originating at the turret's `muzzleTip` world position and traveling toward the crosshair target.
- **Hit Detection Invariance (`server/GameEngine.ts`, `tests/server.test.ts`)**:
  - Aim coordinates and hit detection (`checkZombieHit`, `projectWorldToScreen`) do not depend on turret positions.
  - Added **Test Suite 16** proving identical hit results (headshot, body hit, miss) across fixed aim coordinates regardless of whether 1 or 8 players are connected.

---

### Phase 2: Central Notification Queue, Score Popup Merging & In-Place Streak Badges
- **Central Banner Notification Queue (`src/game/uiNotificationQueue.ts`, `src/game/GameApp.tsx`, `src/game/HudOverlay.tsx`)**:
  - Created a central banner queue showing **at most one large banner at a time** in the upper third of the screen (`top-[14.5%]`), styled on a single line (`whitespace-nowrap`) so it never overlaps the top Forcefield HP bar or the center action.
  - Queued banners older than **2,000 ms** (`BANNER_MAX_AGE_MS = 2000`) are automatically dropped before display.
- **Target-Merged Score Popups (`mergeOrCreateScorePopup`)**:
  - Rapid hits on the same zombie/target (`targetId`) merge in place into a single updating popup (`+pts`, `x2`, `x3`, etc.) near the target, floating upward and fading out in **`0.8s`** (`SCORE_POPUP_DURATION_MS = 800`).
- **In-Place Hit Streak Display (`formatStreakBadge`)**:
  - One streak badge per player anchored inside that player's bottom turret card, updated in place and never stacked.
  - Multiplier is capped with a `"MAX"` label (`8X MAX`) with a visual progress bar.
- **Clear Center Screen**:
  - Removed all persistent floating center cards; the middle of the screen remains completely clear for gameplay.

---

### Phase 3: Clean TV HUD, Hidden Debug Controls (`F2`), & 3-Meter Legibility
- **Debug & Test UI Hidden by Default (`src/App.tsx`, `src/game/HudOverlay.tsx`, `src/game/GameApp.tsx`, `shared/config.ts`)**:
  - Hid the `TV / Phone` mode switch, `Auto-fire`, `Auto-reload`, `Unlimited` toggles, and the `Arcade Test Deck` by default.
  - Added **Key `F2`** (`debugUiVisible`) to toggle all debug/test controls on or off.
  - Set `DEFAULT_SETTINGS.autoFire = false` in `shared/config.ts` so auto-fire is never enabled by default in a real game.
- **Clean Top HUD Bar & Discrete `[TAB]` Menu**:
  - Top bar shows only **Stage Name & Wave**, **Forcefield Integrity HP**, and the **Boss Health Bar** (only when a boss is active).
  - Moved Audio, Music, Settings, and Lobby controls into a discrete `[TAB] MENU` drawer in the top-right corner (`Tab` key or button click).
- **Turret Weapon Toasts**:
  - Weapon-crate pickups display as compact toasts (`TurretToast`) directly above the collecting player's bottom turret rather than covering the center screen.
- **TV Safe-Area Padding & 3-Meter Typography**:
  - Applied TV overscan safe-area padding (`px-[3.5vw] pt-[2.5vh] pb-[2.2vh]`) and enlarged primary HUD numbers (`26px–28px+` bold monospace with high-contrast text shadows).

---

### Phase 4: Crosshair Visibility & Stray Object Cleanup
- **Player-Colored Crosshairs (`src/game/HudOverlay.tsx`)**:
  - Enlarged crosshairs to `80px` (`w-20 h-20`) in each player's color with high-contrast `#020617` dark outlines so they remain visible over bright explosions and neon lights.
  - Added a fading 4-point motion trail (`crosshairTrailsRef`), a subtle scale pulse on hit (`hitConfirmAt`), and a compact `1P` / `2P` badge attached below the ring.
- **Stray Objects Identified & Fixed (`src/game/ThreeScene.ts`, `src/game/ParticleSystem.ts`)**:
  1. **Floating White Blocks**:
     - *Root Cause*: In `ThreeScene.ts`, the prop car cabin (`carCabin`, `BoxGeometry(1.8, 0.62, 2.0)`) used pure bright white `0xf8f9fa` sitting on top of a dark navy `carBody` (`0x1d3557`) that blended into the dark asphalt road, making the white cabin box look like an unattached floating white block. Additionally, `ParticleSystem.ts` rendered a bright `0xffffff` wireframe torus ring around floating crates.
     - *Fix*: Restyled `carBody` (`0x334155`) and `carCabin` (`0x1e293b` dark slate glass with amber hazard lights) and replaced the white wireframe ring on power-up crates with a soft translucent colored energy ring.
  2. **Unidentified Gray Shape on the Right Side of the Frame**:
     - *Root Cause*: In `ThreeScene.ts`, `createCityTree()` attached an asymmetric low-poly `DodecahedronGeometry(0.75, 1)` bush offset at `(0.45, 0.45, 0.35)` next to a 9-meter-wide flat gray sidewalk slab (`sidewalkR`, `0x2b2d42` at `x = +14.5`) and wide gray `archHeader` (`0x1e293b`), which caught strong specular glare from the directional light at `(12, 22, 10)` on the right edge of the viewport.
     - *Fix*: Removed the asymmetric `DodecahedronGeometry` bush, narrowed and darkened the curb geometry, and tucked background buildings behind `z = -24`.

---

### Phase 5: Config-Driven Stage Theming — Stage 2: Bio-Lab Reactor
- **Config-Driven Stage Definitions (`shared/types.ts`, `shared/config.ts`)**:
  - Extended `StageDefinition` with `propSet` (`'downtown' | 'biolab' | 'citadel'`), `propList`, `roadColor`, `sidewalkColor`, `ambientParticleColor`, `musicTrackId`, and `ambienceTrackId`.
- **Stage 2: Bio-Lab Reactor Environment (`src/game/ThreeScene.ts`)**:
  - Replaces outdoor city buildings, trees, and moon with an indoor **Bio-Lab Reactor** chamber featuring:
    - Green/teal bioluminescent lighting and toxic fog (`#021a14` / `#10b981`).
    - 8 cylindrical glass **Bio-Containment Tubes** (`vat_tube`) with glowing green specimen cores, rising animated air bubbles (`vatBubbles`), and pulsing point lights.
    - **Bio-Hazard Warning Signs** (`biohazard_sign`) mounted on containment pillars.
    - Rising green/teal **Floor Steam & Vapor Clouds** (`steam_vent` / `labSteamClouds`) and metal grating walkways (`metal_grating_walkway`).
    - A massive rotating **Bio-Reactor Core** (`reactor_core`) with dual counter-rotating energy rings at the end of the corridor.
    - Simulated flickering overhead fluorescent hazard lights.

---

### Phase 6: Boss Presentation
- **Boss Entrance & Active Fight UI (`src/game/HudOverlay.tsx`, `src/game/GameApp.tsx`, `src/game/ThreeScene.ts`)**:
  - **Entrance Warning**: Triggers a red perimeter warning vignette flash (`bossWarningFlash`), camera shake, boss roar audio + music ducking, and a queued single-line Boss Name banner (`⚠ BIO-EXPERIMENT ALPHA — AIM FOR THE GLOWING WEAK POINT!`).
  - **Top Boss Health Bar with Phase Markers**: Positioned cleanly in the top HUD bar with **33% and 66% HP phase markers** (`left-1/3` and `left-2/3`), active phase badge (`PHASE 1 / 2 / 3`), and weak-point callout badge.
  - **Weak Point Visibility**: 3D pulsing red/white weak-point sphere on the boss mesh + floating `"CRITICAL"` indicator on the HUD.
  - **Boss Kill Slow-Mo**: Triggers slow-motion and queues the `"★ BOSS ELIMINATED — AREA SECURED ★"` banner in the upper third of the screen without blocking the death animation.

---

### Phase 7: Deterministic Review Scene (`F4`) & Full Verification
- **Deterministic Screenshot / Review Scene (`Key F4`)**:
  - Pressing **`F4`** on the TV screen (or sending `{ type: 'trigger_review_scene', stageIndex: 1 }`) immediately sets up a deterministic review scene containing:
    - **4 active players** (`1P`–`4P`) with bottom-edge turrets, varied ammo/weapons, streak badges (including `8X MAX`), and active crosshairs.
    - **Stage 2: Bio-Lab Reactor** environment with glowing green containment vats, rising floor steam, and the rotating reactor core.
    - **1 active Boss** (`BIO-EXPERIMENT ALPHA`) with an exposed weak point and the top Boss Health Bar (with 33%/66% phase markers).
    - **4 regular zombies** across lanes (`normal`, `fast`, `tank`), a merged score popup (`+320 CRIT! x3`), a turret weapon toast (`1P +SHOTGUN`), and an upper-third single-line banner.

---

## Keyboard Shortcuts for Review
| Key | Action |
| :--- | :--- |
| **`F2`** | Toggle hidden Debug & Test UI (`TV/Phone` switch, `Auto-fire`, `Auto-reload`, `Unlimited`, `Arcade Test Deck`) |
| **`F3`** | Toggle real-time Performance Telemetry overlay (FPS, Server Tick Hz, Render ms, Players, Zombies) |
| **`F4`** | Trigger deterministic **4-Player Stage 2 Bio-Lab Reactor + Boss Review Scene** |
| **`H`** | Toggle 3D Head/Body Hitbox wireframe spheres & capsules on the TV |
| **`Tab`** | Open/close discrete top-right Arcade Cabinet Menu (Audio, Music, Settings, Lobby) |
| **`M`** | Mute / unmute master audio |

---

## Verification Summary

### Verified via Automated Tests (`npm test` — 18 Test Suites Passed)
- **Suite 16 (Phase 1)**: Hit-detection invariance across fixed screen aim points (`headshot`, `body`, `miss`) before and after moving turrets to the bottom edge for 1 to 8 players.
- **Suite 17 (Phase 2)**:
  - `dequeueNextFreshBanner()` shows 1 banner at a time and drops queued banners older than `2000 ms`.
  - `mergeOrCreateScorePopup()` merges rapid hits on the same `targetId` into one updating popup (`hitCount`, accumulated points) and expires popups after `800 ms`.
  - `formatStreakBadge()` caps the visible multiplier at `8X MAX`.
- **Suite 18 (Phases 3, 5, 6 & 7)**:
  - `DEFAULT_SETTINGS.autoFire` is `false` by default.
  - `STAGES[1]` (`Stage 2: Bio-Lab Reactor`) is config-driven with `propSet: 'biolab'`, containment tubes, bio-hazard signs, steam vents, and distinct lighting/audio IDs.
  - `engine.triggerReviewScene(1)` deterministically spawns 4 active players, Stage 2 Bio-Lab Reactor, 1 Boss with active weak point, and 4 lane zombies.
- **TypeScript & Lint Verification**:
  - `compile_applet` (`tsc --noEmit`) and `lint_applet` passed with zero errors.

### What to Check Visually on Your PC / TV Screen
1. Start a match or press **`F4`** to load the deterministic 4-player Bio-Lab Boss scene.
2. Verify the **4 player turrets** sit along the bottom foreground edge in player colors, smoothly tilt toward crosshairs, fire short upward tracers (`~120 ms`), and never cover the barricade.
3. Verify the **Bio-Lab Reactor** environment shows glowing green containment vats with rising bubbles, floor steam, and the rotating reactor core—with no floating white car-cabin blocks or right-side gray tree/sidewalk artifacts.
4. Verify the **Boss Health Bar** at the top displays 33% and 66% phase markers and the single-line banner stays in the upper third without covering the center action.
5. Press **`F2`** to confirm all debug controls (`TV/Phone`, `Auto-fire`, `Arcade Test Deck`) are hidden by default and only appear when `F2` is toggled on.
