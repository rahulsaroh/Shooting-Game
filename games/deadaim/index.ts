import { GameEngine } from '../../server/GameEngine.ts';
import { GameServerAdapter, PlatformPlayer } from '../../platform/types.ts';

export const DEADAIM_GAME_ID = 'deadaim';

export function createDeadAimServerAdapter(gameEngine: GameEngine): GameServerAdapter {
  return {
    id: DEADAIM_GAME_ID,
    onActivate(players: PlatformPlayer[]) {
      // Ensure all connected platform lobby players are registered in DeadAim's GameEngine
      for (const p of players) {
        if (p.isConnected) {
          gameEngine.handleJoin(p.name, p.color, p.reconnectToken);
        }
      }
    },
    onDeactivate() {
      // Return DeadAim to LOBBY state cleanly when exiting to the platform menu
      if (gameEngine.getPhase() !== 'LOBBY') {
        gameEngine.restartGame();
      }
    },
    onPlayerJoin(player: PlatformPlayer) {
      gameEngine.handleJoin(player.name, player.color, player.reconnectToken);
    },
    onPlayerDisconnect(playerId: string) {
      gameEngine.handleDisconnect(playerId);
    },
  };
}
