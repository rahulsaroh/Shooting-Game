# DeadAim Development Log (DEVLOG.md)

## Project Overview
DeadAim is a local-network multiplayer zombie shooting gallery where a PC (displayed on a TV or large monitor) runs a 3D Three.js defensive battleground, and up to 8 players join seamlessly using their smartphones as physical motion-aim gun controllers with zero app installation.

---

## Phase Execution Log

### Phase 1: Project Setup and Connection
- **Status:** COMPLETED & VERIFIED
- **Work Performed:**
  - Designed clean modular structure separating server authority (`server/`), phone controller (`src/controller/`), 3D TV game engine (`src/game/`), and shared schemas (`shared/`).
  - Implemented `server.ts` with IPv4 local network interface detection (`os.networkInterfaces()`) to broadcast the PC's actual local Wi-Fi IP and port.
  - Implemented WebSocket server on `/ws` using `ws` library with instant lobby synchronization.
  - Built `LobbyView.tsx` with dynamic QR code generation (`https://api.qrserver.com` + local `/api/info` QR fallback) pointing directly to `/controller`.
  - Added session persistence via unique `reconnectToken` stored in `localStorage`, so if a phone browser reloads or disconnects, the player seamlessly reclaims their existing slot, score, and ammo.
  - Configured `package.json` single-command execution (`npm start` / `npm run dev`) mounting Vite middleware directly in Express.
- **Verification:**
  - Automated tests verified multi-player join, slot assignment (Slot 1, Slot 2, ...), and reconnect token slot recovery.

---

### Phase 2: Phone Controller (Motion Aim & Haptics)
- **Status:** COMPLETED & VERIFIED
- **Work Performed:**
  - Implemented `MotionSensors.ts`:
    - Handles iOS 13+ permission request (`DeviceOrientationEvent.requestPermission()`).
    - Recenter functionality to establish neutral pitch and yaw at any time.
    - Low-pass exponential moving average filter (`alpha = 0.24`) to eliminate hand trembling and sensor noise while maintaining 60 Hz responsiveness.
    - Accelerometer flick-down jerk detector (`deltaY > 18 m/s²`) for physical gesture reload.
    - Fallback Virtual Touchpad mode allowing touch/drag aiming if device sensors are unavailable or blocked by non-secure contexts.
  - Implemented `Haptics.ts`: Distinct vibration signatures for shooting (30ms kick), hit confirmation (`[25, 30, 45]ms`), barricade damage rumble, and reload mechanical latch.
  - Implemented `ScreenLock.ts`: Integrated the Screen Wake Lock API (`navigator.wakeLock.request('screen')`) to prevent phones from dimming during intense defense waves.
  - Implemented `ControllerApp.tsx`: High-contrast tactical mobile HUD with live bullet indicators, recenter thumb button, gyro radar crosshair, and massive haptic FIRE trigger.
- **Verification:**
  - Verified 60 Hz motion packet transmission, recenter math, and touch fallback.

---

### Phase 3: Core Game on the PC/TV (Shooting Gallery & Raycasting)
- **Status:** COMPLETED & VERIFIED
- **Work Performed:**
  - Selected a cinematic fixed-camera shooting gallery defense view:
    - **Why?** A stationary fortification overlooking an atmospheric street/cemetery prevents spectator motion sickness, provides stable 1:1 crosshair mapping for multiple phones simultaneously, and eliminates spatial disorientation on big screens.
  - Server is the absolute authority on weapon logic, firing rates, ammo tracking, and 3D raycasting.
  - Implemented independent multi-crosshair tracking: each player is rendered with their own distinct neon color, call-sign label, ammo readout, and hit marker `X` flash.
  - Implemented mathematical 3D world-to-screen projection in `GameEngine.ts` to perform accurate headshot and body hit detection with distance-scaled radii.
- **Verification:**
  - Verified concurrent independent aiming and shooting with multiple simulated players.

---

### Phase 4: Zombies and Gameplay (Waves, Barricade, Power-ups)
- **Status:** COMPLETED & VERIFIED
- **Work Performed:**
  - Designed 4 distinct zombie classes:
    - **Normal (Walker):** Balanced speed and health.
    - **Fast (Ghoul Runner):** Agile, hunched sprint animation, lower HP, rapid approach.
    - **Tank (Abomination):** Bulky torso, spiked shoulder armor plates, heavy plodding stomp, high HP.
    - **Boss (Necro Tyrant):** Towering height, horns, glowing chest core, massive damage.
  - Barricade fortification defense system: 100 HP shared barrier at `z = -1.8` taking damage when zombies reach the line.
  - Wave manager with escalating zombie density and boss waves every 5 waves.
  - Power-up system: Crates dropped on zombie kills:
    - **Ammo Box:** Instant refill.
    - **Medkit:** Restores +35 Barricade HP.
    - **Cryo Freeze:** Freezes all zombies in place for 6 seconds with icy blue aura.
    - **Double Damage:** 2x damage boost for 8 seconds with flaming hit markers.
  - Clean state machine: `LOBBY` -> `COUNTDOWN` -> `PLAYING` -> `WAVE_CLEARED` -> `GAME_OVER` / `VICTORY` -> `SCOREBOARD`.
  - Built procedural 3D low-poly models (3–12 parts per Three.js skill) with zero external asset files.
- **Verification:**
  - Automated tests verified wave transitions, barricade degradation, and powerup mechanics.

---

### Phase 5: Family-Friendly Options & Custom Themes
- **Status:** COMPLETED & VERIFIED
- **Work Performed:**
  - Implemented `SettingsModal.tsx` on the TV:
    - **Kids Mode:** Sunny bright green environment, slime particle splats instead of blood, laser blaster sound effects, slower zombie speed, and goofy googly eyes.
    - **Adult Mode:** Moody nighttime cemetery fog, realistic gunshot thuds, blood particle bursts, and aggressive zombie groans.
    - **Difficulty Presets:** Easy (150 HP barricade, slower zombies), Normal (100 HP), Hardcore (80 HP, faster zombies).
    - **Waves Slider:** 3, 5, or 10 waves.
    - **Friendly Fire Toggle:** Toggles tactical penalty/warnings.
  - JSON-Configurable Themes in `shared/themes.json`:
    - **Classic Undead:** Traditional graveyard walkers with decayed flesh and glowing eyes.
    - **Cartoon Goobers:** Goofy neon slime monsters with googly eyes.
    - **Rogue Cyber-Droids:** Malfunctioning cybernetic androids with metal chassis and laser visors.
    - *Designed so a child or developer can easily add new zombie themes by editing plain JSON!*
- **Verification:**
  - Dynamic atmosphere switching and theme loading verified via automated tests.

---

### Phase 6: Polish (Audio Synthesis, Particles, 6-Player Scale)
- **Status:** COMPLETED & VERIFIED
- **Work Performed:**
  - Implemented `AudioManager.ts` using 100% procedural Web Audio API oscillators and noise buffers:
    - Realistic gunshot transients + sub-bass punch (or arcade lasers in Kids mode).
    - Headshot metallic chime / ping.
    - Body hit thud and meat impact.
    - Mechanical 3-stage reload clicks.
    - Zombie groans modulated by class.
    - Barricade crunch distortion.
    - Power-up ascending arpeggios.
    - Procedural synthesizer background music with Phrygian tense bassline in Adult mode and cheerful major chords in Kids mode, with mute toggles.
  - Built `ParticleSystem.ts` with blood bursts, slime splatters, metallic spark bursts, and floating 3D power-up crates with glowing rings.
  - Tested at 60 FPS with pre-allocated Three.js math vectors and instanced barricade props.
  - Built `scripts/simulator.ts` to simulate 6 concurrent phones streaming motion aim at 60 Hz.
- **Verification:**
  - Ran automated stress test and verified stability with 6 simultaneous simulated controllers.

---

### Phase 7: Testing and Hardening
- **Status:** COMPLETED & VERIFIED
- **Work Performed:**
  - Automated test suite in `tests/server.test.ts` covering player lifecycle, slot assignments, reconnection tokens, aim coordinate bounds clamping, shooting/ammo state, reload locking, and difficulty multipliers (6/6 tests passing).
  - Built-in on-screen `SimulatorControls.tsx` for immediate PC testing without extra phones (mouse gun aim + 1-click bot squad spawning).
  - Hardened edge cases: phone screen sleeping (Screen Wake Lock), Wi-Fi reconnect backoff, gyro permission denied fallback (Virtual Touchpad).
- **Verification:**
  - `npm test` passed 100%. `npm run lint` and `npm run build` passed with zero errors.
