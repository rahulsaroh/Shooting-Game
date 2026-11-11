# DeadAim Horror & Arcade Audio Asset Guide (`/public/audio/`)

This directory contains the `.wav` (or `.mp3` / `.ogg`) audio files loaded by `src/game/AudioManager.ts` using the Web Audio API (`AudioContext.decodeAudioData`), cached in memory, and spatialized in 3D via `PannerNode` (`HRTF`).

All sound paths, volumes, random pitch ranges (`pitchRange`), and bus assignments (`sfx`, `voice`, `music`) are configured in **`/shared/audio.json`** so you can add or swap audio files without modifying TypeScript code.

> **Built-in Default Audio & Never-Crash Fallback:**
> DeadAim includes generated `.wav` files in `/public/audio/` out of the box (created via `npx tsx scripts/generate-assets.ts`). If any audio file is missing or fails to decode, `AudioManager.ts` logs a console warning and automatically falls back to procedural Web Audio synthesis so the game **never crashes**.

---

## 1. Exact Filenames & Categories (`shared/audio.json`)

### A. `/public/audio/weapons/` (Gunshots, Reloads, Impacts, Power-ups)
- `shot_01.wav`, `shot_02.wav`, `shot_03.wav` — Heavy arcade handgun/shotgun blasts (Adult Mode)
- `laser_pew_01.wav`, `laser_pew_02.wav`, `laser_pew_03.wav` — Sci-fi cartoon laser blasters (Kids Mode)
- `empty_click_01.wav`, `empty_click_02.wav` — Dry-fire metallic trigger clicks when out of ammo
- `reload_01.wav`, `reload_02.wav` — Magazine slide & chamber rack sounds
- `headshot_ding_01.wav`, `headshot_crunch_02.wav`, `headshot_ding_03.wav` — Crisp headshot bell/crunch confirmation
- `body_hit_01.wav`, `body_hit_02.wav`, `body_hit_03.wav` — Flesh impact thuds (Adult Mode)
- `boing_hit_01.wav`, `boing_hit_02.wav`, `boing_hit_03.wav` — Silly cartoon boing/splat impacts (Kids Mode)
- `barricade_impact_01.wav`, `barricade_impact_02.wav` — Heavy metallic crunch when zombies claw the barricade
- `powerup_chime_01.wav` — Ascending arcade arpeggio when shooting a floating power-up crate

### B. `/public/audio/zombies/` (3D Spatial HRTF Zombie Voices)
Each zombie type (`normal`, `fast`, `tank`, `boss`) has 3–4 variations per vocal state (`idle`, `aggro`, `attack`, `hit`, `death`) played with a random `+/- 10%` pitch shift (`[0.9, 1.1]`):

- **Normal Walker (`normal`):**
  - `normal_idle_01.wav` .. `normal_idle_04.wav`
  - `normal_aggro_01.wav` .. `normal_aggro_03.wav`
  - `normal_attack_01.wav` .. `normal_attack_04.wav`
  - `normal_hit_01.wav` .. `normal_hit_03.wav`
  - `normal_death_01.wav` .. `normal_death_04.wav`
- **Fast Runner (`fast`):**
  - `fast_idle_01.wav` .. `fast_idle_03.wav`
  - `fast_aggro_01.wav` .. `fast_aggro_03.wav`
  - `fast_attack_01.wav` .. `fast_attack_03.wav`
  - `fast_hit_01.wav` .. `fast_hit_03.wav`
  - `fast_death_01.wav` .. `fast_death_03.wav`
- **Tank Brute (`tank`):**
  - `tank_idle_01.wav` .. `tank_idle_03.wav`
  - `tank_aggro_01.wav` .. `tank_aggro_03.wav`
  - `tank_attack_01.wav` .. `tank_attack_03.wav`
  - `tank_hit_01.wav` .. `tank_hit_03.wav`
  - `tank_death_01.wav` .. `tank_death_03.wav`
- **Boss Overlord (`boss`):**
  - `boss_idle_01.wav` .. `boss_idle_03.wav`
  - `boss_aggro_01.wav` .. `boss_aggro_03.wav`
  - `boss_attack_01.wav` .. `boss_attack_03.wav`
  - `boss_hit_01.wav` .. `boss_hit_03.wav`
  - `boss_death_01.wav` .. `boss_death_03.wav`
  - `boss_entrance_roar_01.wav` — Unique deep monster roar played with a camera shake and music duck when the Boss spawns
- **Kids / Cartoon Mode Voices (`kids`):**
  - `kids_goofy_groan_01.wav` .. `kids_goofy_groan_03.wav`
  - `kids_squeak_01.wav` .. `kids_squeak_03.wav`
  - `kids_chomp_01.wav` .. `kids_chomp_03.wav`
  - `kids_boing_01.wav` .. `kids_boing_03.wav`
  - `kids_pop_01.wav` .. `kids_pop_03.wav`

### C. `/public/audio/ambience/` (Looping Atmospheric Beds)
- `horror_wind_moans_loop.wav` — Dark eerie wind, distant moans, and metallic creaks (Adult Mode)
- `kids_arcade_breeze_loop.wav` — Warm upbeat carnival/arcade room ambience (Kids Mode)

### D. `/public/audio/music/` (Dynamic 3-Layer Adaptive Music & Heartbeat)
- `layer_calm_loop.wav` — Low-intensity dark pulsing bassline (Wave start / few zombies)
- `layer_tense_loop.wav` — Mid-intensity driving synth tension (Zombies advancing)
- `layer_intense_loop.wav` — High-intensity industrial combat pulse (Horde close to barricade or Boss active)
- `heartbeat_low_hp_loop.wav` — Deep rhythmic heartbeat that fades in when barricade HP drops below 30% (Adult Mode only)
- `kids_upbeat_loop.wav` — Cheerful chiptune/arcade loop (Kids Mode)

### E. `/public/audio/stingers/` (Event Stingers)
- `stinger_wave_start.wav`
- `stinger_wave_cleared.wav`
- `stinger_boss_arrival.wav`
- `stinger_victory.wav`
- `stinger_defeat.wav`

### F. `/public/audio/announcer/` (Arcade Voice Callouts)
- `announcer_wave_start.wav` — *"Wave incoming! Defend the barricade!"*
- `announcer_boss_incoming.wav` — *"Warning! Giant boss approaching!"*
- `announcer_barricade_low.wav` — *"Danger! Barricade integrity critical!"*
- `announcer_victory.wav` — *"Stage clear! Victory achieved!"*
- `announcer_defeat.wav` — *"Barricade breached. Game over."*

---

## 2. Recommended Audio Sources & Licensing Note

1. **Freesound.org (CC0 Public Domain Filter):**
   - [https://freesound.org](https://freesound.org) — Filter by **Creative Commons 0 (CC0)** license for zombie growls, gunshots, wind ambience, and heartbeats.
2. **Pixabay Sound Effects & Music:**
   - [https://pixabay.com/sound-effects/](https://pixabay.com/sound-effects/) — Free horror stingers, monster roars, and dark synthwave loops.
3. **Kenney Digital Audio Packs (CC0 Public Domain):**
   - [https://kenney.nl/assets/category:Audio](https://kenney.nl/assets/category:Audio) — Sci-Fi Sounds, Impact Sounds, UI Audio, and Voiceover Pack (Arcade Announcer).
4. **AI Sound & Voice Generation:**
   - **ElevenLabs Sound Effects / Voice Design** (for deep arcade announcer callouts and creature vocalizations) or **Stable Audio** (for seamless horror ambient beds).

> **⚠️ License & Attribution Reminder:**
> Always verify the license of downloaded audio files before redistributing or publishing your build. Prefer **CC0 (Public Domain)** or royalty-free assets that do not require per-track attribution, or record any required CC-BY attributions in your project credits.

---

## 3. Previewing Sound Categories on the TV (`Key K` & `Key M`)

- Press **`K`** on the TV keyboard to cycle through and preview all 6 sound categories (`Weapons`, `3D HRTF Zombie Voices`, `Boss Entrance Roar`, `Dynamic Music & Heartbeat`, `Horror Stingers`, and `Announcer Voice`).
- Press **`M`** on the TV keyboard to mute/unmute all audio instantly.
