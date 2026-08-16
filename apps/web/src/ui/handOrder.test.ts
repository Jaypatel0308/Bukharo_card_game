import { describe, expect, it } from 'vitest';
import { createDeck } from '@bukharo/game-engine';
import type { Card, NaturalRank, Suit } from '@bukharo/game-engine';

import { pickedUpThisTurn, planHandOrder, reorderForDrag } from './handOrder';

const DECK = createDeck();

function card(rank: NaturalRank, suit: Suit, deckNumber: 1 | 2 = 1): Card {
  const found = DECK.find((c) => c.rank === rank && c.suit === suit && c.deckNumber === deckNumber);
  if (!found) throw new Error(`no such card: ${rank} ${suit}`);
  return found;
}

const joker = DECK.find((c) => c.isJoker)!;
const ids = (cards: Card[]) => cards.map((c) => c.id);

describe('planHandOrder', () => {
  const hand = [card('5', 'spades'), card('9', 'spades'), card('3', 'hearts')];

  it('sorts a fresh hand by the active mode', () => {
    const order = planHandOrder({
      cards: hand,
      previousOrder: [],
      manualOrder: false,
      sortMode: 'suit',
    });
    // Spades sort before hearts, and rank ascends within a suit.
    expect(order).toEqual(ids([card('5', 'spades'), card('9', 'spades'), card('3', 'hearts')]));
  });

  it('slots a drawn card into place rather than appending it', () => {
    const previous = planHandOrder({
      cards: hand,
      previousOrder: [],
      manualOrder: false,
      sortMode: 'suit',
    });
    const drew = card('7', 'spades');
    const order = planHandOrder({
      cards: [...hand, drew],
      previousOrder: previous,
      manualOrder: false,
      sortMode: 'suit',
    });
    expect(order.indexOf(drew.id)).toBe(1); // between the 5 and the 9 of spades
    expect(order.at(-1)).not.toBe(drew.id);
  });

  it('keeps a hand the player arranged, and slots new cards into it', () => {
    // A deliberately unsorted arrangement.
    const manual = ids([card('3', 'hearts'), card('9', 'spades'), card('5', 'spades')]);
    const drew = card('7', 'spades');
    const order = planHandOrder({
      cards: [...hand, drew],
      previousOrder: manual,
      manualOrder: true,
      sortMode: 'suit',
    });
    // The player's three stay in their chosen sequence.
    expect(order.filter((id) => manual.includes(id))).toEqual(manual);
    // And the newcomer is placed, not appended blindly.
    expect(order).toHaveLength(4);
    expect(order.indexOf(drew.id)).toBeGreaterThanOrEqual(0);
  });

  it('drops cards that have left the hand', () => {
    const previous = ids(hand);
    const order = planHandOrder({
      cards: [card('5', 'spades')],
      previousOrder: previous,
      manualOrder: true,
      sortMode: 'suit',
    });
    expect(order).toEqual([card('5', 'spades').id]);
  });

  it('places every card of a taken discard pile', () => {
    const taken = [card('2', 'clubs'), card('K', 'diamonds'), card('4', 'hearts')];
    const order = planHandOrder({
      cards: [...hand, ...taken],
      previousOrder: ids(hand),
      manualOrder: true,
      sortMode: 'suit',
    });
    expect(new Set(order)).toEqual(new Set(ids([...hand, ...taken])));
    expect(order).toHaveLength(6);
  });

  it('keeps jokers at the end whichever sort is active', () => {
    for (const mode of ['suit', 'rank', 'points'] as const) {
      const order = planHandOrder({
        cards: [joker, ...hand],
        previousOrder: [],
        manualOrder: false,
        sortMode: mode,
      });
      expect(order.at(-1)).toBe(joker.id);
    }
  });
});

describe('pickedUpThisTurn', () => {
  const hand = [card('5', 'spades'), card('9', 'spades')];

  it('highlights a single drawn card', () => {
    const drew = card('7', 'spades');
    expect(pickedUpThisTurn([...hand, drew], new Set(ids(hand)))).toEqual([drew.id]);
  });

  it('highlights every card of a taken pile', () => {
    const taken = [card('2', 'clubs'), card('K', 'diamonds')];
    expect(pickedUpThisTurn([...hand, ...taken], new Set(ids(hand)))).toEqual(ids(taken));
  });

  it('highlights nothing on a fresh deal', () => {
    // Nothing was held before, so every card is new — which is not news.
    expect(pickedUpThisTurn(hand, new Set())).toEqual([]);
  });

  it('highlights nothing when the whole hand is replaced by the Bucharoo', () => {
    const bucharoo = [card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs')];
    expect(pickedUpThisTurn(bucharoo, new Set(ids(hand)))).toEqual([]);
  });

  it('highlights nothing when only cards left the hand', () => {
    expect(pickedUpThisTurn([card('5', 'spades')], new Set(ids(hand)))).toEqual([]);
  });
});

describe('reorderForDrag', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('moves a card to the requested slot', () => {
    expect(reorderForDrag(order, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderForDrag(order, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('leaves the order alone when nothing would move', () => {
    expect(reorderForDrag(order, 'b', 1)).toBe(order);
    expect(reorderForDrag(order, 'zzz', 1)).toBe(order);
  });

  it('never loses or duplicates a card', () => {
    for (let target = 0; target < order.length; target++) {
      const next = reorderForDrag(order, 'c', target);
      expect([...next].sort()).toEqual([...order].sort());
    }
  });
});
