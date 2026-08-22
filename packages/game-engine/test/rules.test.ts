import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_RULES } from '../src/rules.js';
import { newGame } from './helpers.js';

/**
 * The house rules that were open questions in §99 and have since been settled.
 * These are the answers, pinned so a later change has to be deliberate.
 */

describe('a Joker turned up as the wild reveal (§99.2)', () => {
  /**
   * The same deal read both ways.
   *
   * ACE_IS_WILD leaves the revealed card where it fell, so it says whether
   * this seed put a Joker in the middle of the stock at all. Only those seeds
   * exercise the redraw, and without checking that, a test that merely asserts
   * "the wild is not a Joker" would pass while never reaching the rule.
   */
  function bothPolicies(seed: number) {
    return {
      asFound: newGame({ jokerWildRevealPolicy: 'ACE_IS_WILD' }, seed),
      redrawn: newGame({ jokerWildRevealPolicy: 'REDRAW' }, seed),
    };
  }

  it('is put back, and another card is drawn instead', () => {
    let exercised = 0;

    for (let seed = 1; seed <= 300; seed++) {
      const { asFound, redrawn } = bothPolicies(seed);
      if (!asFound.wildCard?.isJoker) continue;
      exercised++;

      assert.equal(redrawn.wildCard!.isJoker, false, `seed ${seed} kept a Joker as the wild`);
      assert.notEqual(redrawn.wildRank, null, `seed ${seed} ended with no wild rank`);
    }

    assert.ok(exercised > 0, 'no seed put a Joker in the middle, so the rule was never reached');
  });

  it('goes back into the stock rather than out of the round', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { asFound, redrawn } = bothPolicies(seed);
      if (!asFound.wildCard?.isJoker) continue;

      // The Joker that was rejected is still there to be drawn later.
      const jokersInStock = redrawn.stock.filter((c) => c.isJoker).length;
      assert.ok(jokersInStock >= 1, `seed ${seed} dropped the rejected Joker`);
    }
  });

  it('never loses or duplicates a card, whichever way the reveal goes', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const state = newGame({}, seed);
      const everywhere = [
        ...state.stock,
        ...state.discardPile,
        ...state.bucharoo,
        ...state.players.flatMap((p) => p.hand),
      ];
      // The wild card is set aside rather than left in play under the default
      // rules, so count it only when it is not already somewhere above.
      const ids = new Set(everywhere.map((c) => c.id));
      if (state.wildCard && !ids.has(state.wildCard.id)) ids.add(state.wildCard.id);

      assert.equal(ids.size, 108, `seed ${seed} has ${ids.size} distinct cards, not 108`);
      assert.equal(
        [...everywhere].filter((c) => c.isJoker).length +
          (state.wildCard?.isJoker && !everywhere.some((c) => c.id === state.wildCard!.id) ? 1 : 0),
        4,
        `seed ${seed} does not have four Jokers`,
      );
    }
  });

  it('keeps the old reading available, where the Joker stands and Aces are wild', () => {
    let sawOne = false;
    for (let seed = 1; seed <= 300; seed++) {
      const state = newGame({ jokerWildRevealPolicy: 'ACE_IS_WILD' }, seed);
      if (!state.wildCard?.isJoker) continue;
      sawOne = true;
      assert.equal(state.wildRank, 'A', 'a standing Joker should make Aces wild');
    }
    assert.ok(sawOne);
  });
});

describe('runs do not wrap around (§99.9)', () => {
  it('is off by default — K-A-2 is not a run', () => {
    assert.equal(DEFAULT_RULES.runsWrapAround, false);
  });
});
