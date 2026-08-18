import { describe, expect, it } from 'vitest';
import { createDeck } from '@bukharo/game-engine';
import type { Card, NaturalRank, Suit } from '@bukharo/game-engine';

import { cardLabel, cardText, compareCards, isWild, sortHand } from './cards';

const DECK = createDeck();
const card = (rank: NaturalRank, suit: Suit): Card =>
  DECK.find((c) => c.rank === rank && c.suit === suit && c.deckNumber === 1)!;
const joker = DECK.find((c) => c.isJoker)!;

describe('compareCards', () => {
  it('groups by suit then ascends by rank', () => {
    const sorted = sortHand([card('K', 'hearts'), card('2', 'spades'), card('5', 'spades')], 'suit');
    expect(sorted.map(cardText)).toEqual(['2♠', '5♠', 'K♥']);
  });

  it('descends by rank across suits', () => {
    const sorted = sortHand([card('2', 'spades'), card('A', 'hearts'), card('9', 'clubs')], 'rank');
    expect(sorted.map((c) => c.rank)).toEqual(['A', '9', '2']);
  });

  it('descends by point value', () => {
    const sorted = sortHand([card('3', 'clubs'), card('A', 'clubs'), card('K', 'clubs')], 'points');
    expect(sorted.map((c) => c.basePointValue)).toEqual([15, 10, 5]);
  });

  it('is antisymmetric, so sorting is stable whichever order cards arrive in', () => {
    const cards = [card('4', 'hearts'), card('4', 'spades'), joker, card('A', 'clubs')];
    for (const mode of ['suit', 'rank', 'points'] as const) {
      const compare = compareCards(mode);
      for (const a of cards) {
        for (const b of cards) {
          // Written as a sum to sidestep JavaScript's -0 !== 0 under Object.is.
          expect(Math.sign(compare(a, b)) + Math.sign(compare(b, a))).toBe(0);
        }
      }
    }
  });
});

describe('wild cards', () => {
  it('treats jokers and the round rank as wild', () => {
    expect(isWild(joker, '6')).toBe(true);
    expect(isWild(card('6', 'hearts'), '6')).toBe(true);
    expect(isWild(card('7', 'hearts'), '6')).toBe(false);
    expect(isWild(card('6', 'hearts'), null)).toBe(false);
  });

  it('does not announce a wild card, so no player is told which of theirs are wild', () => {
    // Discarding a wild is a mistake players are allowed to make; flagging
    // them would remove a decision and give screen reader users information
    // the rest of the table does not have.
    expect(cardLabel(card('6', 'hearts'), '6')).toBe('6 of hearts');
    expect(cardLabel(card('7', 'hearts'), '6')).toBe('7 of hearts');
    expect(cardLabel(joker, '6')).toBe('Joker');
  });
});
