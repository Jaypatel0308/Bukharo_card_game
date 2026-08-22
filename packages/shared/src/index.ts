import type {
  EngineErrorCode,
  GameView,
  MeldType,
  RuleConfig,
  Seat,
  TeamId,
  WildAssignment,
} from '@bukharo/game-engine';

import type { MindiView } from '@bukharo/game-mindi';

import type { GameId } from './games.js';

export type { GameView, RuleConfig, Seat, TeamId, WildAssignment };
export type { MindiView };

/**
 * A game's state, as a client sees it.
 *
 * Tagged by game so the client can narrow to the right table. This is the one
 * place that names both games — the seam between a room, which is the same
 * whatever is being played, and the game inside it.
 */
export type GameSnapshot =
  | { gameId: 'bukharo'; view: GameView }
  | { gameId: 'mindi'; view: MindiView };
export * from './games.js';

/** §32 — no O/0 or I/1/l, so codes survive being read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export type RoomStatus = 'LOBBY' | 'PLAYING' | 'ROUND_END' | 'MATCH_END' | 'ABANDONED';

export interface RoomPlayerView {
  id: string;
  displayName: string;
  /** Place in the ring, 0-based. Teams alternate, so even is A and odd is B. */
  position: number | null;
  /** What to call that place in this game, e.g. "North" or "Seat 3". */
  seatLabel: string | null;
  teamId: TeamId | null;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
}

export interface RoomView {
  roomId: string;
  roomCode: string;
  /** Which game this room is for. Fixed when the room is made. */
  gameId: GameId;
  status: RoomStatus;
  hostId: string | null;
  /** Host-editable display names for the two teams. */
  teamNames: Record<TeamId, string>;
  players: RoomPlayerView[];
  /** Null while the room is still in the lobby. */
  game: GameSnapshot | null;
  /** Bukharo's rule config, present only for a Bukharo room. */
  rules: RuleConfig | null;
  /** What the match is played to: a score for Bukharo, Kot for Mindi. */
  target: number;
  /** Seat the viewer occupies, if any. */
  youId: string | null;
  /** Null when the host may start, otherwise why they may not. */
  cannotStartReason: string | null;
  /** Set while an active player is disconnected and the table is waiting (§54). */
  waitingForPlayerId: string | null;
  /** When that wait began, so the client can show the host when they may skip. */
  waitingSince: number | null;
  /** How long the table waits before the host may pass an absent player. */
  disconnectGraceMs: number;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Client → server                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a client may ask a game to do.
 *
 * A union rather than one loose shape, so the compiler checks each game's
 * actions instead of waving them through. Every module still validates the
 * payload again at runtime — types are erased, and the server is the
 * authority — but a table can no longer send its own game an action that game
 * has never heard of.
 */
export interface BukharoActionPayload {
  type: 'DRAW_STOCK' | 'TAKE_DISCARD_PILE' | 'CREATE_MELD' | 'ADD_TO_MELD' | 'DISCARD';
  cardIds?: string[];
  cardId?: string;
  meldId?: string;
  meldType?: MeldType;
  wildAssignments?: WildAssignment[];
}

export type MindiActionPayload =
  | { type: 'CHOOSE_MODE'; mode: 'HIDDEN' | 'KATTE' }
  | { type: 'REVEAL_TRUMP' }
  | { type: 'PLAY_CARD'; cardId: string };

export type GameActionPayload = BukharoActionPayload | MindiActionPayload;

export type ClientMessage =
  | {
      type: 'room:create';
      actionId: string;
      displayName: string;
      target: number;
      gameId: GameId;
    }
  | { type: 'room:join'; actionId: string; displayName: string; roomCode: string }
  | { type: 'session:resume'; sessionToken: string }
  | { type: 'room:leave' }
  | { type: 'player:ready'; ready: boolean }
  | { type: 'seat:choose'; position: number }
  | { type: 'host:assignSeat'; playerId: string; position: number }
  | { type: 'host:kick'; playerId: string }
  | { type: 'host:settings'; target: number }
  | { type: 'host:teamName'; teamId: TeamId; name: string }
  | { type: 'host:endMatch' }
  | { type: 'host:skipTurn' }
  | { type: 'game:start'; actionId: string }
  | { type: 'game:action'; actionId: string; action: GameActionPayload }
  | { type: 'round:next'; actionId: string }
  | { type: 'match:restart'; actionId: string }
  | { type: 'ping' };

/* ------------------------------------------------------------------ */
/* Server → client                                                     */
/* ------------------------------------------------------------------ */

export type ServerErrorCode =
  | EngineErrorCode
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_PROGRESS'
  | 'NAME_REQUIRED'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'SEAT_TAKEN'
  | 'NOT_READY'
  | 'INVALID_MESSAGE'
  | 'SESSION_INVALID'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ServerError {
  code: ServerErrorCode;
  message: string;
  /** Present for AMBIGUOUS_WILD — the interpretations to offer the player. */
  options?: WildAssignment[][];
  actionId?: string;
}

export type ServerMessage =
  | { type: 'session'; sessionToken: string; playerId: string; roomCode: string }
  | { type: 'room:state'; room: RoomView }
  | { type: 'game:event'; event: { type: string; payload: Record<string, unknown> } }
  | { type: 'error'; error: ServerError }
  | { type: 'left' }
  | { type: 'pong' };

export const TARGET_SCORE_OPTIONS = [1000, 1500, 2000, 3000] as const;
