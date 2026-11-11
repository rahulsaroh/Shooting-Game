# Multi-Game Arcade Platform Plan (`/docs/platform-plan.md`)

## 1. Architectural Strategy & Why DeadAim Stays in Place

Per **Rule 1 & Rule 2**, DeadAim must keep working exactly as it does today without refactoring, renaming, or changing its internal logic, and the target structure explicitly notes:
> *"if moving it is risky, leave DeadAim's files where they are and register it with the platform through a small adapter file instead. Prefer the safest option and explain your choice."*

**Decision: Keep DeadAim's existing files in their exact current paths (`/server/GameEngine.ts`, `/shared/*`, `/src/game/*`, `/src/controller/*`, `/tests/server.test.ts`) and register DeadAim through `/games/deadaim/index.ts`.**

**Why this is the safest choice:**
1. `tests/server.test.ts` and `scripts/simulator.ts` import directly from `../server/GameEngine.ts`, `../shared/types.ts`, `../shared/config.ts`, and `../src/game/uiNotificationQueue.ts`. Leaving those files in place guarantees 0 broken imports and 100% test compatibility.
2. All internal relative imports inside DeadAim (`../../shared/types.ts`, `./ThreeScene.ts`, etc.) remain completely untouched.
3. Standalone DeadAim mode (`/game?standalone=deadaim` or `DEADAIM_STANDALONE=1`) continues to work identically alongside the new multi-game launcher.

---

## 2. Target Directory Structure

```text
/backup/deadaim-v1/                   # Full pre-change backup copy (excluding node_modules)
/docs/
  deadaim-baseline.md                 # Baseline behavior, protocol, and test results
  platform-plan.md                    # Architecture, file touch list, risks & rollback plan
/platform/
  games.json                          # Declarative Game Registry (id, title, description, thumbnail, min/max players, controllerType, status)
  types.ts                            # Platform session, lobby player, and namespaced WebSocket message types
  server/
    PlatformManager.ts                # Manages shared phone lobby, active game session, reconnect tokens, and gameId message routing
  client/
    LauncherMenu.tsx                  # TV Arcade Cabinet Game Selection Menu (mouse, keyboard, or host phone controlled)
    PlatformControllerShell.tsx       # Shared phone controller shell (join once via QR, stay connected across game switches)
  shared/
    network.ts                        # Local IP detection, QR code generation, HTTPS status helper
    haptics.ts                        # Shared phone vibration patterns
    wakeLock.ts                       # Shared phone Screen Wake Lock manager
    motion.ts                         # Shared gyroscope/accelerometer tilt & smoothing utility
    highScores.ts                     # Per-game persistent JSON high score manager
/games/
  deadaim/
    index.ts                          # Lightweight adapter registering DeadAim with the platform (zero changes to DeadAim logic)
  <game2-name>/                       # Game #2 (completely separate folder: server logic, TV Three.js scene, phone controller)
    server/
    client/
    controller/
    shared/
```

---

## 3. WebSocket Namespacing & Session Isolation

1. **Single Persistent Phone Connection**:
   - Phones scan the QR code once and join the platform lobby with `name`, `color`, and `reconnectToken` (persisted in `localStorage`).
   - The platform assigns each phone a persistent `playerId`, `slot` (1–8), `color`, and `isHost` (Slot 1 connected phone is host, or re-assigned if Slot 1 disconnects).
   - When the active game changes (`menu` -> `deadaim` -> `menu` -> `<game2>`), the platform broadcasts `{ type: 'platform_state', activeGameId, lobbyPlayers, games }`. All connected phones automatically hot-swap their controller UI to match `activeGameId` without disconnecting or re-scanning.
2. **Per-Game Message Namespacing (`gameId`)**:
   - Platform-level messages use `gameId: 'platform'` (e.g., `platform_select_game`, `platform_return_menu`, `platform_join`).
   - Game-specific messages carry `gameId: '<game-id>'` (e.g., `gameId: 'deadaim'` or `gameId: '<game2>'`).
   - **Backward Compatibility for DeadAim**: When `activeGameId === 'deadaim'` (or when running `npm run sim`), un-tagged DeadAim `ClientMessage` payloads (`aim`, `shoot`, `reload`, `phone_join`, etc.) are automatically routed to DeadAim's `GameEngine`, and DeadAim's `ServerMessage` broadcasts include `gameId: 'deadaim'` alongside their original fields so both legacy DeadAim listeners and platform-aware listeners work without conflict.
   - **Strict Isolation**: If a message arrives with `gameId !== activeGameId`, the server ignores it immediately so two games can never leak state or messages into each other. Only one game session ticks at a time.

---

## 4. Exact List of DeadAim Files to Be Touched (Minimal Wiring Only)

In accordance with **Rule 2**, no DeadAim gameplay, visuals, audio, balance, settings, or internal logic will be changed. Only these minimal wiring edits will be made in Phase 2:

1. **`/server.ts` (Lines 71–351)**:
   - Wire `PlatformManager` into the HTTP `/api/platform/*` endpoints and `/ws` handler so the server can switch between `'menu'`, `'deadaim'`, and Game #2, while forwarding all DeadAim messages and `/api/info`, `/api/state`, `/api/action` calls to DeadAim's existing `gameEngine` instance.
2. **`/src/App.tsx` (Lines 1–96)**:
   - Render the Platform wrapper by default (which displays `<LauncherMenu />` on TV when `activeGameId === 'menu'`, `<GameApp onBackToMenu={...} />` when `activeGameId === 'deadaim'`, and Game #2 when `activeGameId === '<game2>'`), while preserving direct standalone access via `/deadaim` or `?game=deadaim`.
3. **`/src/game/GameApp.tsx` (Lines 29, 707–711, 842–924)**:
   - Accept an optional `onBackToMenu?: () => void` prop.
   - Pass `onBackToMenu` to `LobbyView`, `HudOverlay`, `ScoreboardView`, and `SettingsModal`, and support long-pressing `Escape` (or pressing `Backspace` in Lobby) on TV to return to the platform menu.
4. **`/src/game/SettingsModal.tsx` (Lines 19–26, 448–455)**:
   - Accept optional `onBackToMenu?: () => void` prop and render a `"BACK TO ARCADE MENU"` button in the modal footer when provided.
5. **`/src/game/LobbyView.tsx` (Lines 22–33, 215–223)**:
   - Accept optional `onBackToMenu?: () => void` prop and render a `"Back to Menu"` button in the top header bar when provided.
6. **`/src/controller/ControllerApp.tsx` (Lines 39, 279–294)**:
   - Accept optional `onBackToMenu?: () => void` prop so the host phone (or player) can see/return to the platform menu when needed, while keeping all DeadAim controller behavior identical.
7. **`/package.json` (Lines 6–15)**:
   - Keep `"start": "tsx server.ts"` (runs the full platform + DeadAim) and add `"start:deadaim": "DEADAIM_STANDALONE=true tsx server.ts"` so DeadAim can also be launched standalone with a single command.

---

## 5. Risks & Rollback Plan

### Identified Risks & Mitigations
- **Risk 1: WebSocket connections dropping or losing player slots when switching from Menu to DeadAim.**
  - *Mitigation*: When a phone joins on the platform menu, `PlatformManager` immediately registers the phone's `name`, `color`, and `reconnectToken` with DeadAim's `gameEngine.handleJoin(...)` as well, so the player's slot (`1P..8P`) and token are pre-synchronized before DeadAim even launches.
- **Risk 2: Three.js WebGL context / Audio loop leaks when switching games.**
  - *Mitigation*: Mounting/unmounting `<GameApp />` already calls `threeSceneRef.current?.dispose()` and `audioRef.current?.stopBackgroundMusic()` in its `useEffect` cleanup (`GameApp.tsx` lines 289–294). Game #2 will implement the exact same strict WebGL and Web Audio disposal lifecycle.
- **Risk 3: Invalid or missing game folder in `/platform/games.json` crashing the launcher.**
  - *Mitigation*: The game registry loader validates each entry at startup and marks any missing/broken game module as `status: "unavailable"` with a graceful fallback card on the menu rather than throwing an unhandled exception.

### One-Command Rollback Plan
If any change ever needs to be rolled back to the exact pre-platform DeadAim v1 state:
```bash
cp -rf backup/deadaim-v1/* . && npm test
```
This restores every source file, configuration file, and test to the verified baseline in `/backup/deadaim-v1/`.
