import type { Card, NaturalRank, Rank, Suit } from './types.js';

export const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

export const NATURAL_RANKS: NaturalRank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

export const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

/** §6 — point values. The round wild rank keeps its ordinary value. */
export function cardPointValue(rank: Rank): number {
  if (rank === 'JOKER') return 30;
  if (rank === 'A') return 15;
  if (['8', '9', '10', 'J', 'Q', 'K'].includes(rank)) return 10;
  return 5; // 2-7
}

/**
 * Run ordering value. Aces are ambiguous (low or high) and are resolved by the
 * run validator, so this returns the *high* value for aces by convention.
 */
export function rankOrdinal(rank: NaturalRank): number {
  switch (rank) {
    case 'A': return 14;
    case 'K': return 13;
    case 'Q': return 12;
    case 'J': return 11;
    default: return Number(rank);
  }
}

const ORDINAL_TO_RANK: Record<number, NaturalRank> = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export function ordinalToRank(ordinal: number): NaturalRank | null {
  return ORDINAL_TO_RANK[ordinal] ?? null;
}

/** §5 — two 52-card decks plus four jokers = 108 unique physical cards. */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const deckNumber of [1, 2] as const) {
    for (const suit of SUITS) {
      for (const rank of NATURAL_RANKS) {
        cards.push({
          id: `d${deckNumber}-${rank}${suit[0]!.toUpperCase()}`,
          deckNumber,
          rank,
          suit,
          basePointValue: cardPointValue(rank),
          isJoker: false,
        });
      }
    }
    for (const n of [1, 2] as const) {
      cards.push({
        id: `d${deckNumber}-JOKER${n}`,
        deckNumber,
        rank: 'JOKER',
        suit: null,
        basePointValue: cardPointValue('JOKER'),
        isJoker: true,
      });
    }
  }
  return cards;
}

/** Is this physical card usable as a wild this round? */
export function isWildCard(
  card: Card,
  wildRank: NaturalRank | null,
  opts: { jokersAreWild: boolean; roundWildEnabled: boolean },
): boolean {
  if (card.isJoker) return opts.jokersAreWild;
  if (!opts.roundWildEnabled || wildRank === null) return false;
  return card.rank === wildRank;
}

export function cardLabel(card: Card): string {
  if (card.isJoker) return 'Joker';
  return `${card.rank}${SUIT_SYMBOLS[card.suit!]}`;
}

export function sumPoints(cards: Card[]): number {
  return cards.reduce((total, card) => total + card.basePointValue, 0);
}
