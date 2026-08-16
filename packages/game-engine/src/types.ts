/**
 * Core Bukharo domain types.
 *
 * Everything in this package is pure and deterministic: no I/O, no timers, no
 * browser or server APIs. Randomness always enters through an injected `Rng`.
 */

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

/** Ranks a natural (non-joker) card can carry. */
export type NaturalRank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A';

export type Rank = NaturalRank | 'JOKER';

export interface Card {
  /** Unique per physical card. Two decks means two `AS` cards with different ids. */
  id: string;
  deckNumber: 1 | 2;
  rank: Rank;
  /** Jokers have no suit. */
  suit: Suit | null;
  basePointValue: number;
  isJoker: boolean;
}

export type Seat = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';
export type TeamId = 'TEAM_A' | 'TEAM_B';

export type HandType = 'ORIGINAL' | 'BUCHAROO';

export type MeldType = 'SET' | 'RUN';

/** How a single card is being used inside a meld. */
export interface MeldCard {
  card: Card;
  /**
   * NATURAL — the card is itself (a real 7♥ sitting in a heart run).
   * WILD — the card is substituting for something else (joker, or a
   * round-wild-rank card standing in for another card).
   */
  role: 'NATURAL' | 'WILD';
  /** The rank this card represents inside the meld. */
  representedRank: NaturalRank;
  /** The suit this card represents. `null` for cards in a SET. */
  representedSuit: Suit | null;
}

export interface Meld {
  id: string;
  teamId: TeamId;
  type: MeldType;
  cards: MeldCard[];
  /** A meld is clean when it contains no card in the WILD role. */
  isClean: boolean;
  /** True once the meld has reached `rules.bucharoMinimumCards`. */
  isBucharo: boolean;
  /** Which bonus was locked in when the meld first became a Bucharo. */
  bucharoBonusAwarded: 'NONE' | 'CLEAN' | 'DIRTY';
  createdByPlayerId: string;
  /** True for the run that opened the team. */
  isOpeningMeld: boolean;
}

export interface GamePlayer {
  id: string;
  displayName: string;
  seat: Seat;
  teamId: TeamId;
  hand: Card[];
  handType: HandType;
}

export interface TeamState {
  id: TeamId;
  playerIds: string[];
  isOpened: boolean;
  matchScore: number;
  /** Round-scoped flags, reset every round. */
  tookBucharoo: boolean;
  wentOut: boolean;
}

export type TurnPhase =
  | 'AWAITING_DRAW'
  | 'PLAYING_CARDS'
  | 'AWAITING_DISCARD'
  | 'TURN_COMPLETE';

export type GameStatus =
  | 'LOBBY'
  | 'DEALING'
  | 'PLAYING'
  | 'ROUND_END'
  | 'MATCH_END'
  | 'PAUSED'
  | 'ABANDONED';

export interface LogEntry {
  seq: number;
  roundNumber: number;
  timestamp: number;
  playerId: string | null;
  type: string;
  /** Human readable, never contains privately-drawn card identities. */
  message: string;
  meta?: Record<string, unknown>;
}

export interface TeamRoundScore {
  teamId: TeamId;
  cardPoints: number;
  cleanBucharoBonus: number;
  dirtyBucharoBonus: number;
  bucharooBonus: number;
  goingOutBonus: number;
  handPenalty: number;
  roundTotal: number;
  /** Cumulative match score after this round is applied. */
  matchTotalAfter: number;
  breakdown: {
    cleanBucharos: number;
    dirtyBucharos: number;
    cardsLeftInHands: number;
  };
}

export interface RoundScoreRecord {
  roundNumber: number;
  wildRank: NaturalRank;
  teams: Record<TeamId, TeamRoundScore>;
  endedBy: 'WENT_OUT' | 'NO_DRAW_SOURCE' | 'ABANDONED';
  endedByPlayerId: string | null;
}

export interface GameState {
  roomId: string;
  status: GameStatus;
  roundNumber: number;
  targetScore: number;

  players: GamePlayer[];
  teams: Record<TeamId, TeamState>;

  dealerPlayerId: string;
  currentPlayerId: string;
  turnPhase: TurnPhase;
  /** True once the current player has drawn/taken this turn. */
  hasDrawnThisTurn: boolean;
  /** Completed turns this round; drives the post-exhaustion lap limit. */
  turnCounter: number;
  /** Turn number at which the stock first ran dry, or null while it has cards. */
  stockEmptiedAtTurn: number | null;

  stock: Card[];
  discardPile: Card[];
  bucharoo: Card[];

  /** The card revealed from mid-stock that fixes the round's wild rank. */
  wildCard: Card | null;
  wildRank: NaturalRank | null;

  melds: Meld[];

  bucharooTaken: boolean;
  bucharooTakenByTeamId: TeamId | null;
  bucharooTakenByPlayerId: string | null;

  scoreHistory: RoundScoreRecord[];
  /** Winner once status is MATCH_END. */
  winningTeamId: TeamId | null;

  log: LogEntry[];
  /** Incremented on every successful state mutation. */
  stateVersion: number;
  /** Monotonic counter backing `LogEntry.seq` and generated ids. */
  seqCounter: number;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Explicit wild interpretation supplied by the client (see §43 of the spec). */
export interface WildAssignment {
  cardId: string;
  representedRank: NaturalRank;
  representedSuit: Suit | null;
}

export interface DrawStockAction {
  type: 'DRAW_STOCK';
  playerId: string;
}

export interface TakeDiscardPileAction {
  type: 'TAKE_DISCARD_PILE';
  playerId: string;
}

export interface CreateMeldAction {
  type: 'CREATE_MELD';
  playerId: string;
  cardIds: string[];
  /** Optional hint; the engine infers the type when omitted. */
  meldType?: MeldType;
  wildAssignments?: WildAssignment[];
}

export interface AddToMeldAction {
  type: 'ADD_TO_MELD';
  playerId: string;
  meldId: string;
  cardIds: string[];
  wildAssignments?: WildAssignment[];
}

export interface DiscardAction {
  type: 'DISCARD';
  playerId: string;
  cardId: string;
}

export type GameAction =
  | DrawStockAction
  | TakeDiscardPileAction
  | CreateMeldAction
  | AddToMeldAction
  | DiscardAction;

export type GameActionType = GameAction['type'];

/* ------------------------------------------------------------------ */
/* Action results                                                      */
/* ------------------------------------------------------------------ */

export type EngineErrorCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'ALREADY_DREW'
  | 'MUST_DRAW_FIRST'
  | 'CARD_NOT_IN_HAND'
  | 'DUPLICATE_CARDS'
  | 'EMPTY_STOCK'
  | 'EMPTY_DISCARD_PILE'
  | 'MELD_TOO_SMALL'
  | 'INVALID_SET'
  | 'INVALID_RUN'
  | 'INVALID_MELD'
  | 'TEAM_NOT_OPENED'
  | 'OPENING_REQUIREMENTS'
  | 'AMBIGUOUS_WILD'
  | 'MELD_NOT_FOUND'
  | 'MELD_WRONG_TEAM'
  | 'MUST_KEEP_DISCARD'
  | 'CANNOT_GO_OUT_YET'
  | 'TOO_MANY_WILDS'
  | 'GAME_NOT_PLAYING';

export interface EngineError {
  ok: false;
  code: EngineErrorCode;
  /** Player-facing message. Must explain the actual problem (§75). */
  message: string;
  /** Present for AMBIGUOUS_WILD: the interpretations the client may choose. */
  options?: WildAssignment[][];
}

export interface EngineSuccess {
  ok: true;
  state: GameState;
  /** Events produced by this action, in order. */
  events: EngineEvent[];
}

export type EngineResult = EngineSuccess | EngineError;

/**
 * Events describe what changed. Anything with `privateToPlayerId` set is only
 * ever forwarded to that one player.
 */
export interface EngineEvent {
  type: string;
  privateToPlayerId?: string;
  payload: Record<string, unknown>;
}
