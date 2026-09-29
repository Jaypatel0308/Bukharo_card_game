import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyAction } from '../src/engine.js';
import { DEFAULT_RULES } from '../src/rules.js';
import type { GameAction, GameState } from '../src/types.js';
import { card, newGame, rules, scenario } from './helpers.js';

/** Applies an action that is expected to be legal, or says why it was not. */
function orThrow(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action, rules());
  if (!result.ok) throw new Error(`${action.type} refused: ${result.code} — ${result.message}`);
  return result.state;
}

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

describe('a hand is emptied by discarding, never by melding (§27)', () => {
  const runOfFour = ['5', '6', '7', '8'].map((rank) =>
    card(rank as Parameters<typeof card>[0], 'hearts').id,
  );

  /** p1 is opened, on turn, has drawn, and holds a clean run of four hearts. */
  function readyToFinish(bucharooTaken: boolean): GameState {
    const base = scenario(newGame(), {
      currentPlayerId: 'p1',
      turnPhase: 'PLAYING_CARDS',
      hasDrawn: true,
      wildRank: '2',
      opened: { TEAM_A: true },
      hands: {
        p1: [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'), card('8', 'hearts')],
      },
    });
    return { ...base, status: 'PLAYING', bucharooTaken };
  }

  function meldEverything(state: GameState) {
    return applyAction(
      state,
      { type: 'CREATE_MELD', playerId: 'p1', meldType: 'RUN', cardIds: runOfFour },
      rules(),
    );
  }

  it('refuses a meld that would leave nothing to throw', () => {
    const result = meldEverything(readyToFinish(true));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'MUST_KEEP_DISCARD');
  });

  it('refuses it even when the Bucharoo is there for the taking', () => {
    // This was the hole: melding to nothing collected the Bucharoo without a
    // discard ever happening, which is a different game from the one played.
    const result = meldEverything(readyToFinish(false));
    assert.equal(result.ok, false, 'the Bucharoo is no excuse to skip the discard');
    if (!result.ok) assert.equal(result.code, 'MUST_KEEP_DISCARD');
  });

  it('lets the hand end the proper way: meld the rest, then throw the last', () => {
    const melded = orThrow(readyToFinish(true), {
      type: 'CREATE_MELD',
      playerId: 'p1',
      meldType: 'RUN',
      cardIds: runOfFour.slice(0, 3),
    });
    const out = orThrow(melded, {
      type: 'DISCARD',
      playerId: 'p1',
      cardId: card('8', 'hearts').id,
    });

    assert.equal(out.teams.TEAM_A.wentOut, true, 'the discard is what goes out');
    assert.equal(out.status, 'ROUND_END');
  });
});
