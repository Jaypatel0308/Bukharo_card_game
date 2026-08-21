/**
 * Mindi (Mendicot) domain types.
 *
 * Pure and deterministic, like Bukharo's engine and entirely separate from it:
 * no I/O, no clock, and randomness only through an injected `Rng`.
 */

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  /** Unique per physical card, so two decks give two distinguishable 10♦. */
  id: string;
  deckNumber: 1 | 2;
  rank: Rank;
  suit: Suit;
}

export type TeamId = 'TEAM_A' | 'TEAM_B';

/** How trump is decided this hand (§13, §26). */
export type TrumpMode = 'HIDDEN' | 'KATTE';

export type MindiStatus = 'CHOOSING_MODE' | 'PLAYING' | 'HAND_END' | 'MATCH_END';

export interface MindiPlayer {
  id: string;
  displayName: string;
  /** Place in the ring. Teams alternate, so even is A and odd is B. */
  position: number;
  teamId: TeamId;
  hand: Card[];
}

export interface MindiTeam {
  id: TeamId;
  name: string;
  playerIds: string[];
  /** §52 — the only tally that carries between hands. */
  kot: number;
  /** Reset each hand. */
  mindisThisHand: number;
  tricksThisHand: number;
}

/**
 * One card on the table.
 *
 * `countedAsTrump` is recorded when the card is played, not worked out later:
 * a trump revealed mid-trick does not reach back and promote cards already
 * lying there (the answer to §21's timing question).
 */
export interface Play {
  playerId: string;
  card: Card;
  countedAsTrump: boolean;
}

export interface Trick {
  leadSuit: Suit | null;
  plays: Play[];
}

export interface CompletedTrick {
  winnerPlayerId: string;
  winningTeamId: TeamId;
  plays: Play[];
  mindis: number;
}

export interface LogEntry {
  seq: number;
  handNumber: number;
  timestamp: number;
  playerId: string | null;
  type: string;
  /** Never names a card nobody at the table could see. */
  message: string;
}

export interface HandResult {
  handNumber: number;
  winningTeamId: TeamId;
  /** How the hand was decided (§48–51). */
  decidedBy: 'MINDIS' | 'TRICKS';
  mindis: Record<TeamId, number>;
  tricks: Record<TeamId, number>;
  /** A clean sweep of every Mindi (§53). */
  sweep: boolean;
  kotAfter: Record<TeamId, number>;
}

export interface MindiState {
  roomId: string;
  status: MindiStatus;
  handNumber: number;
  kotTarget: number;

  players: MindiPlayer[];
  teams: Record<TeamId, MindiTeam>;

  /** §8 — the losing team deals. */
  dealerId: string;
  /** §14 — a player from the winning team hides, and picks the mode. */
  chooserId: string;

  mode: TrumpMode | null;
  /** Face down, and known only to the chooser until revealed (§15). */
  hiddenCard: Card | null;
  hiddenRevealed: boolean;
  trumpSuit: Suit | null;
  /** False while a hidden card waits, or before Katte has settled. */
  trumpActive: boolean;
  /** Set when someone reveals: they must play trump if they hold any (§22). */
  mustPlayTrumpBy: string | null;

  currentPlayerId: string;
  currentTrick: Trick;
  completedTricks: CompletedTrick[];

  handHistory: HandResult[];
  /** Set once a team reaches the Kot target — that team has lost. */
  losingTeamId: TeamId | null;

  log: LogEntry[];
  stateVersion: number;
  seqCounter: number;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export interface ChooseModeAction {
  type: 'CHOOSE_MODE';
  playerId: string;
  mode: TrumpMode;
}

export interface RevealTrumpAction {
  type: 'REVEAL_TRUMP';
  playerId: string;
}

export interface PlayCardAction {
  type: 'PLAY_CARD';
  playerId: string;
  cardId: string;
}

export type MindiAction = ChooseModeAction | RevealTrumpAction | PlayCardAction;

export type MindiErrorCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'NOT_THE_CHOOSER'
  | 'CARD_NOT_IN_HAND'
  | 'MUST_FOLLOW_SUIT'
  | 'MUST_PLAY_TRUMP'
  | 'NOTHING_TO_REVEAL'
  | 'CANNOT_REVEAL_OWN_CARD'
  | 'CAN_STILL_FOLLOW_SUIT'
  | 'GAME_NOT_PLAYING';

export interface MindiError {
  ok: false;
  code: MindiErrorCode;
  /** Player-facing, and explains the actual problem. */
  message: string;
}

export interface MindiEvent {
  type: string;
  /** Forwarded to this player alone; everyone else never sees it. */
  privateToPlayerId?: string;
  payload: Record<string, unknown>;
}

export interface MindiSuccess {
  ok: true;
  state: MindiState;
  events: MindiEvent[];
}

export type MindiResult = MindiSuccess | MindiError;
