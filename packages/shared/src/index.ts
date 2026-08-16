import type {
  EngineErrorCode,
  GameView,
  MeldType,
  RuleConfig,
  Seat,
  TeamId,
  WildAssignment,
} from '@bukharo/game-engine';

export type { GameView, RuleConfig, Seat, TeamId, WildAssignment };

/** §32 — no O/0 or I/1/l, so codes survive being read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export type RoomStatus = 'LOBBY' | 'PLAYING' | 'ROUND_END' | 'MATCH_END' | 'ABANDONED';

export interface RoomPlayerView {
  id: string;
  displayName: string;
  seat: Seat | null;
  teamId: TeamId | null;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
}

export interface RoomView {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  targetScore: number;
  hostId: string | null;
  players: RoomPlayerView[];
  /** Null while the room is still in the lobby. */
  game: GameView | null;
  rules: RuleConfig;
  /** Seat the viewer occupies, if any. */
  youId: string | null;
  /** Set while an active player is disconnected and the table is waiting (§54). */
  waitingForPlayerId: string | null;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Client → server                                                     */
/* ------------------------------------------------------------------ */

export interface GameActionPayload {
  type: 'DRAW_STOCK' | 'TAKE_DISCARD_PILE' | 'CREATE_MELD' | 'ADD_TO_MELD' | 'DISCARD';
  cardIds?: string[];
  cardId?: string;
  meldId?: string;
  meldType?: MeldType;
  wildAssignments?: WildAssignment[];
}

export type ClientMessage =
  | { type: 'room:create'; actionId: string; displayName: string; targetScore: number }
  | { type: 'room:join'; actionId: string; displayName: string; roomCode: string }
  | { type: 'session:resume'; sessionToken: string }
  | { type: 'room:leave' }
  | { type: 'player:ready'; ready: boolean }
  | { type: 'seat:choose'; seat: Seat }
  | { type: 'host:assignSeat'; playerId: string; seat: Seat }
  | { type: 'host:kick'; playerId: string }
  | { type: 'host:settings'; targetScore: number }
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
export const MIN_TARGET_SCORE = 100;
export const MAX_TARGET_SCORE = 20000;
