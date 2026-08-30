import type { Suit } from './types.js';

/**
 * Everything about a match that the players agreed before it began.
 *
 * Judgement leaves far less open than Bukharo did: the rulebook fixes the
 * trump order, the card sequence and the scoring, so the only real choice is
 * how long to play for.
 */
export interface JudgementRules {
  /** §6 — agreed before round one, and the game ends the moment it is met. */
  totalRounds: number;
}

export const DEFAULT_JUDGEMENT_RULES: JudgementRules = {
  totalRounds: 13,
};

export function withJudgementRules(overrides: Partial<JudgementRules> = {}): JudgementRules {
  return { ...DEFAULT_JUDGEMENT_RULES, ...overrides };
}

/**
 * §8 — the most cards everyone can be dealt equally from one deck.
 *
 * Anything that will not divide is left aside for the round (§19).
 */
export function maxCardsFor(playerCount: number): number {
  return Math.floor(52 / playerCount);
}

/**
 * §7, §13 — the card count walks up to the maximum and back down to one,
 * bouncing for as long as the match runs.
 *
 * Written as a walk rather than a formula because the sequence turns at both
 * ends, and an off-by-one at a turn would only show up rounds later.
 */
export function cardsForRound(roundNumber: number, playerCount: number): number {
  const max = maxCardsFor(playerCount);
  if (max <= 1) return 1;

  // The period is one full there-and-back, minus the two turning points that
  // would otherwise be counted twice.
  const period = (max - 1) * 2;
  const step = (roundNumber - 1) % period;
  return step < max ? step + 1 : period - step + 1;
}

/**
 * §21–23 — trump follows its own eight-round cycle, forwards through the
 * suits then backwards, with the suit at each turn repeated. It has nothing to
 * do with whether the card count is rising or falling.
 */
const TRUMP_CYCLE: Suit[] = [
  'spades',
  'diamonds',
  'clubs',
  'hearts',
  'hearts',
  'clubs',
  'diamonds',
  'spades',
];

export function trumpForRound(roundNumber: number): Suit {
  return TRUMP_CYCLE[(roundNumber - 1) % TRUMP_CYCLE.length]!;
}

/**
 * §44–47 — points only for an exact judgement.
 *
 * Zero scores 10 and one scores 11; from two upwards it is ten times the bid.
 * The 11 is not a typo in the rulebook, and a naive `bid * 10` would quietly
 * pay a correct bid of one the wrong amount.
 */
export function scoreFor(bid: number, tricksWon: number): number {
  if (bid !== tricksWon) return 0;
  if (bid === 0) return 10;
  if (bid === 1) return 11;
  return bid * 10;
}

/**
 * §27 — the last bid may not make the total equal the tricks available, so
 * somebody must always be wrong.
 *
 * Only ever forbids one number, and only for the final bidder, so a legal bid
 * always remains.
 */
export function forbiddenBidFor(
  bidsSoFar: number[],
  playerCount: number,
  tricksAvailable: number,
): number | null {
  const isLastBidder = bidsSoFar.length === playerCount - 1;
  if (!isLastBidder) return null;
  const total = bidsSoFar.reduce((sum, bid) => sum + bid, 0);
  const forbidden = tricksAvailable - total;
  return forbidden >= 0 && forbidden <= tricksAvailable ? forbidden : null;
}
