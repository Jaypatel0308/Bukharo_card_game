import type { Card, Rank, Suit } from './types.js';

/** §3 — one standard deck. §4 — A high, 2 low. Jokers are not used. */
export const SUITS: Suit[] = ['spades', 'diamonds', 'clubs', 'hearts'];

export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const RANK_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit[0]}${rank}`, rank, suit });
    }
  }
  return deck;
}

export function cardLabel(card: Card): string {
  const suit = card.suit[0]!.toUpperCase() + card.suit.slice(1);
  return `${card.rank} of ${suit}`;
}
