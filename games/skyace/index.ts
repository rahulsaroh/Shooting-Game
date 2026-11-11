import { GameServerAdapter } from '../../platform/types.ts';

export const SKYACE_GAME_ID = 'skyace';

export function createSkyAcePlaceholderAdapter(): GameServerAdapter {
  return {
    id: SKYACE_GAME_ID,
  };
}
