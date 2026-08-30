import type { GameId } from '@bukharo/shared';

import { bukharoModule } from './bukharo.js';
import { judgementModule } from './judgement.js';
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
  judgement: judgementModule,
};

export function moduleFor(gameId: GameId): GameModule {
  const module = MODULES[gameId];
  if (!module) throw new Error(`No module is registered for the game "${gameId}"`);
  return module;
}

export function isPlayableGame(gameId: string): gameId is GameId {
  return Object.hasOwn(MODULES, gameId);
}

export * from './module.js';
