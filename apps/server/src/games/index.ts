import type { GameId } from '@bukharo/shared';

import { bukharoModule } from './bukharo.js';
import { mindiModule } from './mindi.js';
import type { GameModule } from './module.js';

/**
 * The registry.
 *
 * The only route from the room layer to a game. Everything else in the server
 * is forbidden by lint from importing an engine directly, so a room can never
 * come to depend on which game it happens to be hosting.
 */
const MODULES: Record<GameId, GameModule> = {
  bukharo: bukharoModule,
  mindi: mindiModule,
};

export function moduleFor(gameId: GameId): GameModule {
  return MODULES[gameId];
}

export * from './module.js';
