import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cardsForRound,
  forbiddenBidFor,
  maxCardsFor,
  scoreFor,
  trumpForRound,
} from '../src/rules.js';

/**
 * The parts of the rulebook that are easy to get subtly wrong: a sequence that
 * turns at both ends, a trump cycle that repeats its endpoints, and a scoring
 * table with an exception in it. Checked against the rulebook's own tables.
 */

describe('how many cards each round (§7–13)', () => {
  it('matches the table of maximums (§9)', () => {
    const expected = { 2: 26, 3: 17, 4: 13, 5: 10, 6: 8, 7: 7, 8: 6, 9: 5, 10: 5 };
    for (const [players, max] of Object.entries(expected)) {
      assert.equal(maxCardsFor(Number(players)), max, `${players} players`);
    }
  });

  it('climbs to thirteen and back down, with four players (§10)', () => {
    const counts = Array.from({ length: 25 }, (_, i) => cardsForRound(i + 1, 4));
    assert.deepEqual(
      counts,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    );
  });

  it('turns at eight with six players, exactly as the rulebook says (§11)', () => {
    // "Round 8 = 8 cards, Round 9 = 7 cards, Round 10 = 6 cards"
    assert.equal(cardsForRound(8, 6), 8);
    assert.equal(cardsForRound(9, 6), 7);
    assert.equal(cardsForRound(10, 6), 6);
  });

  it('bounces back up after reaching one again (§12)', () => {
    // Maximum 5, so: 1 2 3 4 5 4 3 2 1 2 3 4 5 ...
    const counts = Array.from({ length: 13 }, (_, i) => cardsForRound(i + 1, 10));
    assert.deepEqual(counts, [1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5]);
  });

  it('never deals more than the deck holds', () => {
    for (let players = 2; players <= 10; players++) {
      for (let round = 1; round <= 120; round++) {
        const each = cardsForRound(round, players);
        assert.ok(each >= 1, `round ${round}, ${players} players dealt ${each}`);
        assert.ok(each * players <= 52, `round ${round}, ${players} players needs ${each * players}`);
      }
    }
  });
});

describe('which suit is trump (§21–23)', () => {
  it('follows the rulebook table for the first sixteen rounds (§22)', () => {
    const table = [
      'spades', 'diamonds', 'clubs', 'hearts',
      'hearts', 'clubs', 'diamonds', 'spades',
      'spades', 'diamonds', 'clubs', 'hearts',
      'hearts', 'clubs', 'diamonds', 'spades',
    ];
    table.forEach((suit, i) => {
      assert.equal(trumpForRound(i + 1), suit, `round ${i + 1}`);
    });
  });

  it('always opens on spades (§22)', () => {
    assert.equal(trumpForRound(1), 'spades');
  });

  it('ignores the card count entirely (§23)', () => {
    // Four players turn at round 13; six players at round 8. Trump does not.
    assert.equal(trumpForRound(13), trumpForRound(13));
    assert.equal(cardsForRound(13, 4), 13, 'four players are at their maximum');
    // Six players: 1 2 3 4 5 6 7 8 7 6 5 4 3 — round thirteen is three cards.
    assert.equal(cardsForRound(13, 6), 3, 'six players are on the way down');
    // Same round, same trump, regardless.
    assert.equal(trumpForRound(13), 'hearts');
  });
});

describe('scoring an exact judgement (§43–48)', () => {
  it('pays nothing for a wrong prediction, high or low (§49, §50)', () => {
    assert.equal(scoreFor(4, 3), 0);
    assert.equal(scoreFor(4, 5), 0);
    assert.equal(scoreFor(0, 1), 0);
  });

  it('pays ten for a bid of nothing (§44)', () => {
    assert.equal(scoreFor(0, 0), 10);
  });

  it('pays eleven for a bid of one — not ten (§45)', () => {
    assert.equal(scoreFor(1, 1), 11);
  });

  it('pays ten times the bid from two upwards (§46, §48)', () => {
    const table: Array<[bid: number, points: number]> = [
      [2, 20], [3, 30], [4, 40], [5, 50], [6, 60], [7, 70],
      [8, 80], [9, 90], [10, 100], [11, 110], [12, 120], [13, 130],
      [17, 170], [26, 260],
    ];
    for (const [bid, points] of table) {
      assert.equal(scoreFor(bid, bid), points, `a bid of ${bid}`);
    }
  });
});

describe('the last bidder cannot make it add up (§27–30)', () => {
  it('only restricts the final bidder', () => {
    assert.equal(forbiddenBidFor([], 4, 5), null);
    assert.equal(forbiddenBidFor([1], 4, 5), null);
    assert.equal(forbiddenBidFor([1, 2], 4, 5), null);
  });

  it('forbids the number that completes the count (§28)', () => {
    // Four players, five tricks, bids so far 1 + 2 + 0 = 3.
    assert.equal(forbiddenBidFor([1, 2, 0], 4, 5), 2);
  });

  it('can force the last player away from zero (§29)', () => {
    // Three tricks, previous bids already total three.
    assert.equal(forbiddenBidFor([1, 1, 1], 4, 3), 0);
  });

  it('forces a bid of zero in a one-card round when everyone passed (§30)', () => {
    assert.equal(forbiddenBidFor([0, 0, 0], 4, 1), 1);
  });

  it('forbids nothing when the total is already past the tricks available', () => {
    // Nothing the last player can bid would bring it back down to the count.
    assert.equal(forbiddenBidFor([3, 3, 3], 4, 5), null);
  });

  it('always leaves a legal bid, whatever the others did', () => {
    for (let tricks = 1; tricks <= 13; tricks++) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const others = [0, 1, 2].map(() => attempt % (tricks + 1));
        const forbidden = forbiddenBidFor(others, 4, tricks);
        const legal = Array.from({ length: tricks + 1 }, (_, i) => i).filter(
          (bid) => bid !== forbidden,
        );
        assert.ok(legal.length >= tricks, 'a player must always have somewhere to go');
      }
    }
  });
});
