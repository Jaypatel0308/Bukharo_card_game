import { SEAT_ORDER, type Seat, type TeamId, type WildAssignment } from '@bukharo/game-engine';

/**
 * Runtime validation of everything a client sends.
 *
 * The protocol types are erased at compile time, so a declared `seat: Seat`
 * proves nothing about the bytes on the wire. Anything reaching the room
 * manager passes through here first: a client that sends a seat of
 * "MIDDLE_OF_THE_TABLE" gets a refusal, not a player with no team.
 */

const SEATS = new Set<string>(SEAT_ORDER);
const TEAM_IDS = new Set<string>(['TEAM_A', 'TEAM_B']);
const RANKS = new Set<string>(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
const SUITS = new Set<string>(['clubs', 'diamonds', 'hearts', 'spades']);

export function asSeat(value: unknown): Seat | null {
  return typeof value === 'string' && SEATS.has(value) ? (value as Seat) : null;
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

/**
 * Wild assignments are forwarded to the rule engine, so a malformed one would
 * surface as an internal error rather than a refusal. Anything that is not a
 * well-formed list is dropped, which simply falls back to the engine resolving
 * the wild card itself.
 */
export function asWildAssignments(value: unknown): WildAssignment[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return undefined;

  const assignments: WildAssignment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return undefined;
    const { cardId, representedRank, representedSuit } = entry as Record<string, unknown>;
    if (typeof cardId !== 'string' || cardId.length > 64) return undefined;
    if (typeof representedRank !== 'string' || !RANKS.has(representedRank)) return undefined;
    if (representedSuit !== null && (typeof representedSuit !== 'string' || !SUITS.has(representedSuit))) {
      return undefined;
    }
    assignments.push({
      cardId,
      representedRank: representedRank as WildAssignment['representedRank'],
      representedSuit: (representedSuit ?? null) as WildAssignment['representedSuit'],
    });
  }
  return assignments;
}
