import type { Card, NaturalRank, Suit } from '@bukharo/game-engine';

export const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

export const SUIT_NAME: Record<Suit, string> = {
  clubs: 'clubs',
  diamonds: 'diamonds',
  hearts: 'hearts',
  spades: 'spades',
};

const RANK_ORDER: Record<string, number> = {
  A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7,
  '6': 6, '5': 5, '4': 4, '3': 3, '2': 2, JOKER: 99,
};

const SUIT_ORDER: Record<Suit, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };

export type SortMode = 'suit' | 'rank' | 'points';

export function isRedSuit(suit: Suit | null): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

export function cardText(card: Card): string {
  if (card.isJoker) return 'JKR';
  return `${card.rank}${SUIT_SYMBOL[card.suit!]}`;
}

/**
 * Spoken by screen readers, so it must not rely on the suit glyph (§74).
 *
 * A wild card is deliberately not announced as wild. Marking them would take
 * away a real decision — discarding a wild is a mistake a player is allowed to
 * make, and one the next player profits from. The round's wild rank is shown
 * on the table for everyone; working out which of your cards match it is part
 * of playing, and a screen reader user gets the same information as anyone
 * else, no more and no less.
 */
export function cardLabel(card: Card, _wildRank: NaturalRank | null): string {
  return card.isJoker ? 'Joker' : `${card.rank} of ${SUIT_NAME[card.suit!]}`;
}

export function isWild(card: Card, wildRank: NaturalRank | null): boolean {
  return card.isJoker || (wildRank !== null && card.rank === wildRank);
}

/**
 * Ordering for one sort mode. Jokers always sort last, where they are easy to
 * find no matter which mode is active.
 */
export function compareCards(mode: SortMode): (a: Card, b: Card) => number {
  return (a, b) => {
    if (a.isJoker !== b.isJoker) return a.isJoker ? 1 : -1;
    switch (mode) {
      case 'rank':
        return (
          (RANK_ORDER[b.rank] ?? 0) - (RANK_ORDER[a.rank] ?? 0) ||
          SUIT_ORDER[a.suit ?? 'spades'] - SUIT_ORDER[b.suit ?? 'spades']
        );
      case 'points':
        return (
          b.basePointValue - a.basePointValue || (RANK_ORDER[b.rank] ?? 0) - (RANK_ORDER[a.rank] ?? 0)
        );
      case 'suit':
      default:
        return (
          SUIT_ORDER[a.suit ?? 'spades'] - SUIT_ORDER[b.suit ?? 'spades'] ||
          (RANK_ORDER[a.rank] ?? 0) - (RANK_ORDER[b.rank] ?? 0)
        );
    }
  };
}

export function sortHand(cards: Card[], mode: SortMode): Card[] {
  return [...cards].sort(compareCards(mode));
}

export function teamName(teamId: string | null): string {
  if (teamId === 'TEAM_A') return 'Team A';
  if (teamId === 'TEAM_B') return 'Team B';
  return 'Unseated';
}

export const SEAT_LABEL: Record<string, string> = {
  NORTH: 'North',
  EAST: 'East',
  SOUTH: 'South',
  WEST: 'West',
};
