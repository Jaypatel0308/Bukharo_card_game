import type { GameId, GameSnapshot } from '@bukharo/shared';

/**
 * The contract between a room and a game.
 *
 * This is the whole of what the room layer may ask a game to do. Everything
 * else — cards, turns, trump, melds, scoring — stays inside the engine, and
 * the room holds its state as an opaque value it cannot inspect.
 *
 * Adding a third game means writing one of these and adding it to the
 * registry. Nothing in the room, session, presence or persistence code
 * changes.
 */

export interface GameSeat {
  id: string;
  displayName: string;
  position: number;
}

export interface GameEvent {
  type: string;
  /** Forwarded to this player alone. */
  privateToPlayerId?: string;
  payload: Record<string, unknown>;
}

export interface GameFailure {
  ok: false;
  code: string;
  message: string;
  /** Anything the client needs to retry, such as a wild-card choice. */
  options?: unknown;
}

export interface GameSuccess {
  ok: true;
  state: unknown;
  events: GameEvent[];
}

export type GameOutcome = GameSuccess | GameFailure;

/** What the room needs to know about how far along a match is. */
export type GamePhase = 'PLAYING' | 'ROUND_END' | 'MATCH_END';

export interface CreateOptions {
  roomId: string;
  seats: GameSeat[];
  target: number;
  teamNames: Record<string, string>;
}

export interface GameModule {
  id: GameId;

  /** Settings the engine keeps, stored alongside the room. */
  settingsFor(target: number): unknown;

  createMatch(options: CreateOptions, settings: unknown): unknown;

  /** Deals the next round or hand of an ongoing match. */
  startNextRound(state: unknown, settings: unknown): unknown;

  /** Turns a client payload into an action, or rejects it. */
  parseAction(payload: unknown, playerId: string): unknown | null;

  applyAction(state: unknown, action: unknown, settings: unknown): GameOutcome;

  /** The redaction boundary. Never called with anything but one player at a time. */
  viewFor(state: unknown, playerId: string | null): GameSnapshot;

  phaseOf(state: unknown): GamePhase;

  /** Whose turn it is, for the disconnect handling the room does. */
  currentPlayerId(state: unknown): string | null;

  /** Moves past a player who has gone; the room decides when that is allowed. */
  skipCurrentPlayer(state: unknown, reason: string): unknown;

  renameTeam(state: unknown, teamId: string, name: string): unknown;

  /** Stamps wall-clock times onto log entries the engine wrote clock-free. */
  stampLog(state: unknown, now: number): void;
}
