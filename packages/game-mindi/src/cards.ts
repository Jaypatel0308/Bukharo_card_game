import type { Card, Rank, Suit } from './types.js';

/**
 * Mindi's card model.
 *
 * Deliberately its own, with no dependency on the Bukharo engine. The two
 * games agree on almost nothing: Mindi has no card point values, ranks its
 * cards differently, and builds three different decks depending on how many
 * people are playing.
 */

export const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/** Lowest to highest, which is also the trick-winning order. */
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

/** §3 — A is high, and a 10 is not promoted by being a Mindi. */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank);
}

/** §4 — the Mindis are the tens, and nothing else. */
export function isMindi(card: Card): boolean {
  return card.rank === '10';
}

export function countMindis(cards: Card[]): number {
  return cards.filter(isMindi).length;
}

function deckOf(deckNumber: 1 | 2): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        id: `d${deckNumber}-${rank}${suit[0]!.toUpperCase()}`,
        deckNumber,
        rank,
        suit,
      });
    }
  }
  return cards;
}

/**
 * §2 — the deck depends on the size of the table.
 *
 *   4 players → one deck, 52 cards, 13 each, 4 Mindis
 *   6 players → two decks less a 2♦ and a 2♣, 102 cards, 17 each, 8 Mindis
 *   8 players → two decks, 104 cards, 13 each, 8 Mindis
 *
 * Every card is dealt in all three cases, which is what keeps every trick the
 * same size and lets the hand end cleanly.
 */
export function buildDeck(playerCount: number): Card[] {
  if (playerCount === 4) return deckOf(1);

  const cards = [...deckOf(1), ...deckOf(2)];
  if (playerCount === 8) return cards;

  if (playerCount === 6) {
    // One copy each of the two black-and-red twos, so 102 divides by six.
    const removed = new Set(['d2-2D', 'd2-2C']);
    return cards.filter((card) => !removed.has(card.id));
  }

  throw new Error(`Mindi seats 4, 6 or 8 players, not ${playerCount}`);
}

export function cardsPerPlayer(playerCount: number): number {
  return buildDeck(playerCount).length / playerCount;
}

export function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}
