export type GameAvailabilityStatus = 'available' | 'coming_soon';

export interface GameRegistryEntry {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: string;
  status: GameAvailabilityStatus;
  folder?: string;
  valid?: boolean;
  validationError?: string;
}

export interface PlatformPlayer {
  id: string;
  name: string;
  color: string;
  slot: number;
  reconnectToken: string;
  isConnected: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface PlatformLobbyState {
  activeGameId: string; // 'menu' | 'deadaim' | 'skyace' | ...
  highlightedGameId: string;
  games: GameRegistryEntry[];
  players: PlatformPlayer[];
}

export type PlatformClientMessage =
  | {
      gameId: 'platform';
      type: 'platform_join';
      name: string;
      color?: string;
      reconnectToken?: string;
    }
  | {
      gameId: 'platform';
      type: 'platform_highlight_game';
      targetGameId: string;
    }
  | {
      gameId: 'platform';
      type: 'platform_select_game';
      targetGameId: string;
    }
  | {
      gameId: 'platform';
      type: 'platform_return_menu';
    }
  | {
      gameId: 'platform';
      type: 'platform_get_state';
    };

export type PlatformServerMessage =
  | {
      gameId: 'platform';
      type: 'platform_state';
      state: PlatformLobbyState;
    }
  | {
      gameId: 'platform';
      type: 'platform_joined';
      player: PlatformPlayer;
      reconnectToken: string;
      state: PlatformLobbyState;
    }
  | {
      gameId: 'platform';
      type: 'platform_error';
      message: string;
    };

export interface GameServerAdapter {
  id: string;
  onActivate?: (players: PlatformPlayer[]) => void;
  onDeactivate?: () => void;
  onPlayerJoin?: (player: PlatformPlayer) => void;
  onPlayerDisconnect?: (playerId: string) => void;
  handleClientMessage?: (playerId: string | undefined, msg: any) => void;
}
