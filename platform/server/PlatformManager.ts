import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GameRegistryEntry,
  GameServerAdapter,
  PlatformClientMessage,
  PlatformLobbyState,
  PlatformPlayer,
  PlatformServerMessage,
} from '../types.ts';
import { PLAYER_COLORS } from '../../shared/config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '../games.json');

export class PlatformManager {
  private games: GameRegistryEntry[] = [];
  private activeGameId: string;
  private highlightedGameId = 'deadaim';
  private players = new Map<string, PlatformPlayer>();
  private tokenToPlayerId = new Map<string, string>();
  private adapters = new Map<string, GameServerAdapter>();
  private broadcastFn: (msg: PlatformServerMessage) => void;
  private sendToPlayerFn: (playerId: string, msg: PlatformServerMessage) => void;

  constructor(
    broadcastFn: (msg: PlatformServerMessage) => void,
    sendToPlayerFn: (playerId: string, msg: PlatformServerMessage) => void,
    options?: {
      registryPath?: string;
      initialGameId?: string;
      validateFolders?: boolean;
    }
  ) {
    this.broadcastFn = broadcastFn;
    this.sendToPlayerFn = sendToPlayerFn;
    this.activeGameId =
      options?.initialGameId ||
      (process.env.DEADAIM_STANDALONE === 'true' ? 'deadaim' : 'menu');
    this.loadRegistry(options?.registryPath || DEFAULT_REGISTRY_PATH, options?.validateFolders ?? true);
  }

  public loadRegistry(registryPath = DEFAULT_REGISTRY_PATH, validateFolders = true): GameRegistryEntry[] {
    try {
      const raw = fs.readFileSync(registryPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.games = [];
        return this.games;
      }

      this.games = parsed
        .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
        .map((item) => {
          const entry: GameRegistryEntry = {
            id: String(item.id),
            title: String(item.title || item.id),
            description: String(item.description || ''),
            thumbnail: String(item.thumbnail || '/assets/aistudio/image_e9d504b0.png'),
            minPlayers: Number(item.minPlayers) || 1,
            maxPlayers: Number(item.maxPlayers) || 8,
            controllerType: String(item.controllerType || 'Phone Controller'),
            status: item.status === 'coming_soon' ? 'coming_soon' : 'available',
            folder: item.folder ? String(item.folder) : `/games/${item.id}`,
            valid: true,
          };

          if (validateFolders && entry.status === 'available') {
            const relFolder = (entry.folder || `/games/${entry.id}`).replace(/^\//, '');
            const absFolder = path.resolve(ROOT_DIR, relFolder);
            if (!fs.existsSync(absFolder)) {
              // Keep menu running safely even if an available game's folder is missing
              entry.valid = false;
              entry.validationError = `Game folder not found: ${entry.folder}`;
            }
          }

          return entry;
        });

      if (this.games.length > 0 && !this.games.some((g) => g.id === this.highlightedGameId)) {
        this.highlightedGameId = this.games[0].id;
      }
    } catch (err) {
      console.warn('PlatformManager: Failed to load games.json safely:', err);
      this.games = [];
    }
    return this.games;
  }

  public registerAdapter(adapter: GameServerAdapter): void {
    this.adapters.set(adapter.id, adapter);
    // Re-validate entry if an adapter is explicitly registered in memory
    const entry = this.games.find((g) => g.id === adapter.id);
    if (entry) {
      entry.valid = true;
      entry.validationError = undefined;
    }
  }

  public getActiveGameId(): string {
    return this.activeGameId;
  }

  public getHighlightedGameId(): string {
    return this.highlightedGameId;
  }

  public getGames(): GameRegistryEntry[] {
    return this.games;
  }

  public getPlayers(): PlatformPlayer[] {
    return Array.from(this.players.values()).sort((a, b) => a.slot - b.slot);
  }

  public getState(): PlatformLobbyState {
    return {
      activeGameId: this.activeGameId,
      highlightedGameId: this.highlightedGameId,
      games: this.games,
      players: this.getPlayers(),
    };
  }

  public broadcastState(): void {
    this.broadcastFn({
      gameId: 'platform',
      type: 'platform_state',
      state: this.getState(),
    });
  }

  private reassignHostIfNeeded(): void {
    const connected = this.getPlayers().filter((p) => p.isConnected);
    if (connected.length === 0) return;
    const hasConnectedHost = connected.some((p) => p.isHost);
    if (!hasConnectedHost) {
      for (const p of this.players.values()) {
        p.isHost = false;
      }
      connected[0].isHost = true;
    }
  }

  private getNextSlot(): number {
    const usedSlots = new Set(Array.from(this.players.values()).map((p) => p.slot));
    for (let s = 1; s <= 8; s++) {
      if (!usedSlots.has(s)) return s;
    }
    return this.players.size + 1;
  }

  /**
   * Registers or reconnects a phone in the shared platform lobby.
   * Accepts an optional pre-generated playerId & token so DeadAim's GameEngine and PlatformManager stay 100% synced.
   */
  public handlePlayerJoin(
    name: string,
    color?: string,
    reconnectToken?: string,
    syncedIdentity?: { id: string; token: string; slot?: number; color?: string }
  ): { player: PlatformPlayer; token: string } {
    const cleanName = (name || '').trim().slice(0, 18) || `Player ${this.players.size + 1}`;

    if (reconnectToken && this.tokenToPlayerId.has(reconnectToken)) {
      const existingId = this.tokenToPlayerId.get(reconnectToken)!;
      const existing = this.players.get(existingId);
      if (existing) {
        existing.name = cleanName || existing.name;
        if (color) existing.color = color;
        existing.isConnected = true;
        this.reassignHostIfNeeded();

        const activeAdapter = this.adapters.get(this.activeGameId);
        activeAdapter?.onPlayerJoin?.(existing);

        this.broadcastState();
        return { player: existing, token: reconnectToken };
      }
    }

    const slot = syncedIdentity?.slot || this.getNextSlot();
    const assignedColor =
      syncedIdentity?.color ||
      color ||
      PLAYER_COLORS[(slot - 1) % PLAYER_COLORS.length].hex;
    const id = syncedIdentity?.id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const token =
      syncedIdentity?.token ||
      reconnectToken ||
      `tok_${id}_${Math.random().toString(36).slice(2, 9)}`;

    const existingPlayer = this.players.get(id);
    if (existingPlayer) {
      existingPlayer.name = cleanName;
      existingPlayer.color = assignedColor;
      existingPlayer.isConnected = true;
      existingPlayer.reconnectToken = token;
      this.tokenToPlayerId.set(token, id);
      this.reassignHostIfNeeded();
      this.broadcastState();
      return { player: existingPlayer, token };
    }

    const connectedCount = this.getPlayers().filter((p) => p.isConnected).length;
    const newPlayer: PlatformPlayer = {
      id,
      name: cleanName,
      color: assignedColor,
      slot,
      reconnectToken: token,
      isConnected: true,
      isHost: connectedCount === 0,
      joinedAt: Date.now(),
    };

    this.players.set(id, newPlayer);
    this.tokenToPlayerId.set(token, id);
    this.reassignHostIfNeeded();

    const activeAdapter = this.adapters.get(this.activeGameId);
    activeAdapter?.onPlayerJoin?.(newPlayer);

    this.broadcastState();
    return { player: newPlayer, token };
  }

  public handlePlayerDisconnect(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.isConnected = false;
    player.isHost = false;
    this.reassignHostIfNeeded();

    const activeAdapter = this.adapters.get(this.activeGameId);
    activeAdapter?.onPlayerDisconnect?.(playerId);

    this.broadcastState();
  }

  public highlightGame(targetGameId: string): boolean {
    const game = this.games.find((g) => g.id === targetGameId);
    if (!game) return false;
    this.highlightedGameId = game.id;
    this.broadcastState();
    return true;
  }

  public selectGame(targetGameId: string): { ok: boolean; error?: string } {
    if (targetGameId === 'menu') {
      this.returnToMenu();
      return { ok: true };
    }

    const game = this.games.find((g) => g.id === targetGameId);
    if (!game) {
      return { ok: false, error: `Unknown game "${targetGameId}"` };
    }
    if (game.status === 'coming_soon') {
      return { ok: false, error: `"${game.title}" is coming soon!` };
    }
    if (game.valid === false) {
      return {
        ok: false,
        error: game.validationError || `"${game.title}" is currently unavailable.`,
      };
    }

    if (this.activeGameId !== 'menu' && this.activeGameId !== targetGameId) {
      const prevAdapter = this.adapters.get(this.activeGameId);
      prevAdapter?.onDeactivate?.();
    }

    this.highlightedGameId = targetGameId;
    this.activeGameId = targetGameId;

    const nextAdapter = this.adapters.get(targetGameId);
    nextAdapter?.onActivate?.(this.getPlayers());

    this.broadcastState();
    return { ok: true };
  }

  public returnToMenu(): void {
    if (this.activeGameId !== 'menu') {
      const prevAdapter = this.adapters.get(this.activeGameId);
      prevAdapter?.onDeactivate?.();
    }
    this.activeGameId = 'menu';
    this.broadcastState();
  }

  /**
   * Enforces per-game WebSocket message namespacing so two games never leak messages into each other.
   */
  public canRouteGameMessage(msg: any): boolean {
    if (!msg || typeof msg !== 'object') return false;
    // Platform messages are always allowed
    if (msg.gameId === 'platform' || String(msg.type || '').startsWith('platform_')) {
      return true;
    }

    // If a message explicitly tags a gameId, it MUST match the currently active game
    if (typeof msg.gameId === 'string') {
      return this.activeGameId === msg.gameId;
    }

    // Un-namespaced messages (DeadAim's original protocol & simulator):
    // Always allow phone_join and ping; allow DeadAim gameplay messages when DeadAim is active or on menu (for simulator auto-test)
    if (msg.type === 'phone_join' || msg.type === 'ping') {
      return true;
    }

    return this.activeGameId === 'deadaim' || this.activeGameId === 'menu';
  }

  public handleClientMessage(
    playerId: string | undefined,
    msg: PlatformClientMessage
  ): { joinedPlayer?: PlatformPlayer; token?: string } | void {
    switch (msg.type) {
      case 'platform_join': {
        const { player, token } = this.handlePlayerJoin(
          msg.name,
          msg.color,
          msg.reconnectToken
        );
        this.sendToPlayerFn(player.id, {
          gameId: 'platform',
          type: 'platform_joined',
          player,
          reconnectToken: token,
          state: this.getState(),
        });
        return { joinedPlayer: player, token };
      }

      case 'platform_highlight_game': {
        this.highlightGame(msg.targetGameId);
        break;
      }

      case 'platform_select_game': {
        const res = this.selectGame(msg.targetGameId);
        if (!res.ok && playerId && res.error) {
          this.sendToPlayerFn(playerId, {
            gameId: 'platform',
            type: 'platform_error',
            message: res.error,
          });
        }
        break;
      }

      case 'platform_return_menu': {
        this.returnToMenu();
        break;
      }

      case 'platform_get_state': {
        this.broadcastState();
        break;
      }
    }
  }
}
