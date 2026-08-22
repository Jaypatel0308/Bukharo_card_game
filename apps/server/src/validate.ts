import { GAMES, isGameId, type GameId } from '@bukharo/shared';

import type { TeamId } from './store.js';

/**
 * Runtime validation of everything a client sends.
 *
 * The protocol types are erased at compile time, so a declared `seat: Seat`
 * proves nothing about the bytes on the wire. Anything reaching the room
 * manager passes through here first: a client that sends a seat of
 * "MIDDLE_OF_THE_TABLE" gets a refusal, not a player with no team.
 */

const TEAM_IDS = new Set<string>(['TEAM_A', 'TEAM_B']);

/** A place at the table, bounded by the largest table any game offers. */
export function asPosition(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  const largestTable = Math.max(...Object.values(GAMES).map((game) => game.maxPlayers));
  return value < largestTable ? value : null;
}

export function asGameId(value: unknown): GameId | null {
  return isGameId(value) ? value : null;
}

export function asTeamId(value: unknown): TeamId | null {
  return typeof value === 'string' && TEAM_IDS.has(value) ? (value as TeamId) : null;
}

export function asString(value: unknown, maxLength = 64): string | null {
  if (typeof value !== 'string') return null;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

export function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
