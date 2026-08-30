/**
 * Judgement — the state a hand of the game is in.
 *
 * Nothing here is shared with Bukharo or Mindi. The three engines have no
 * knowledge of each other, and this one is the first that is scored per
 * player rather than per team.
 */

export type Suit = 'spades' | 'diamonds' | 'clubs' | 'hearts';

/** §4 — A is high, 2 is low, and that never changes. */
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
}

export type JudgementStatus = 'BIDDING' | 'PLAYING' | 'ROUND_END' | 'MATCH_END';

export interface JudgementPlayer {
  id: string;
  displayName: string;
  position: number;
  hand: Card[];
  /** Null until they have judged this round. */
  bid: number | null;
  /** Tricks taken so far this round. */
  tricksWon: number;
  /** Cumulative across the match. */
  score: number;
}

export interface Play {
  playerId: string;
  card: Card;
}

export interface Trick {
  leadSuit: Suit | null;
  plays: Play[];
}

export interface CompletedTrick {
  leadSuit: Suit;
  plays: Play[];
  winnerPlayerId: string;
}

/** What each player did in a finished round, kept for the scoreboard. */
export interface RoundResult {
  roundNumber: number;
  trump: Suit;
  cardsEach: number;
  lines: Array<{
    playerId: string;
    bid: number;
    tricksWon: number;
    scored: number;
    scoreAfter: number;
  }>;
}

export interface LogEntry {
  seq: number;
  timestamp: number;
  playerId: string | null;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface JudgementState {
  roomId: string;
  status: JudgementStatus;

  /** 1-based. Drives both the card count and the trump. */
  roundNumber: number;
  /** How many rounds this match was agreed to run for (§6). */
  totalRounds: number;
  cardsEach: number;
  trump: Suit;

  players: JudgementPlayer[];
  /** §14 — bids first and leads the first trick; rotates each round. */
  startingPlayerId: string;
  /** §16 — immediately left of the starting player. Shown, never used. */
  dealerId: string;
  currentPlayerId: string;

  currentTrick: Trick;
  completedTricks: CompletedTrick[];

  /** §19 — dealt aside, never seen, never played. */
  undealt: Card[];

  roundHistory: RoundResult[];
  /** Set once the match is over; joint winners are possible (§57). */
  winnerPlayerIds: string[];

  log: LogEntry[];
  stateVersion: number;
}
