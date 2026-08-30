import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyJudgementAction, legalBidsFor, legalCardIdsFor, startNextRound } from '../src/engine.js';
import { seededRng } from '../src/random.js';
import { cardsForRound, scoreFor } from '../src/rules.js';
import { viewJudgementFor } from '../src/view.js';
import { newMatch } from './helpers.js';
import type { JudgementState } from '../src/types.js';

/**
 * Whole matches, played end to end at every table size.
 *
 * The unit tests check rules one at a time; this checks that a match actually
 * finishes, that nothing is lost along the way, and that no legal position
 * exists from which a player has nothing to do. A deadlock at seven players in
 * round nineteen is not something anyone finds by reading.
 */

interface Invariants {
  matches: number;
  rounds: number;
  tricks: number;
}

function playMatch(playerCount: number, seed: number, totalRounds: number, tally: Invariants): void {
  const rng = seededRng(seed);
  let state: JudgementState = newMatch(playerCount, seed, { totalRounds });
  let guard = 0;

  while (state.status !== 'MATCH_END' && guard++ < 5000) {
    if (state.status === 'ROUND_END') {
      state = startNextRound(state, rng);
      tally.rounds++;
      continue;
    }

    const playerId = state.currentPlayerId;

    if (state.status === 'BIDDING') {
      const legal = legalBidsFor(state, playerId);
      assert.ok(legal.length > 0, `nobody could bid at ${playerCount} players, seed ${seed}`);
      const bid = legal[rng.nextInt(legal.length)]!;
      const result = applyJudgementAction(state, { type: 'PLACE_BID', playerId, bid });
      assert.ok(result.ok, `a legal bid was refused: ${!result.ok ? result.code : ''}`);
      state = result.state;
      continue;
    }

    // PLAYING
    const legal = legalCardIdsFor(state, playerId);
    assert.ok(legal.length > 0, `nobody could play at ${playerCount} players, seed ${seed}`);
    const cardId = legal[rng.nextInt(legal.length)]!;
    const before = state.completedTricks.length;
    const result = applyJudgementAction(state, { type: 'PLAY_CARD', playerId, cardId });
    assert.ok(result.ok, `a legal card was refused: ${!result.ok ? result.code : ''}`);
    state = result.state;
    if (state.completedTricks.length > before) tally.tricks++;

    // Nobody may hold more than was dealt, and hands only shrink.
    for (const player of state.players) {
      assert.ok(
        player.hand.length <= state.cardsEach,
        `a hand grew beyond the deal at ${playerCount} players`,
      );
    }
  }

  assert.ok(guard < 5000, `the match never finished: ${playerCount} players, seed ${seed}`);
  assert.equal(state.status, 'MATCH_END');
  assert.equal(state.roundNumber, totalRounds, 'it should stop on the agreed round');
  tally.matches++;

  // Every round was scored, and every score follows the table.
  for (const round of state.roundHistory) {
    const tricks = round.lines.reduce((sum, line) => sum + line.tricksWon, 0);
    assert.equal(tricks, round.cardsEach, `round ${round.roundNumber} lost or invented a trick`);
    for (const line of round.lines) {
      assert.equal(
        line.scored,
        scoreFor(line.bid, line.tricksWon),
        `round ${round.roundNumber} scored ${line.playerId} wrongly`,
      );
    }
    // §27 — the bids can never have added up to the tricks available.
    const bids = round.lines.reduce((sum, line) => sum + line.bid, 0);
    assert.notEqual(bids, round.cardsEach, `round ${round.roundNumber} let the bids add up`);
  }

  // Somebody won, and it is whoever actually has the most.
  const best = Math.max(...state.players.map((p) => p.score));
  assert.ok(state.winnerPlayerIds.length >= 1, 'a finished match has a winner');
  for (const id of state.winnerPlayerIds) {
    assert.equal(state.players.find((p) => p.id === id)!.score, best);
  }
}

describe('whole matches, every table size', () => {
  it('finishes without stalling, losing a card or misscoring', () => {
    const tally: Invariants = { matches: 0, rounds: 0, tricks: 0 };
    for (let playerCount = 2; playerCount <= 10; playerCount++) {
      for (let seed = 1; seed <= 12; seed++) {
        // Long enough to pass a turning point in the card sequence.
        playMatch(playerCount, seed * 977, 16, tally);
      }
    }
    assert.ok(tally.matches === 108, `expected 108 matches, played ${tally.matches}`);
    assert.ok(tally.tricks > 3000, `only ${tally.tricks} tricks were played`);
  });

  it('runs long matches that bounce off both ends of the sequence', () => {
    const tally: Invariants = { matches: 0, rounds: 0, tricks: 0 };
    // Ten players cap at five cards, so 40 rounds turns four times.
    for (let seed = 1; seed <= 6; seed++) playMatch(10, seed * 31, 40, tally);
    for (let seed = 1; seed <= 6; seed++) playMatch(4, seed * 37, 30, tally);
    assert.equal(tally.matches, 12);
  });

  it('deals a legal number of cards in every round of a long match', () => {
    for (let playerCount = 2; playerCount <= 10; playerCount++) {
      for (let round = 1; round <= 60; round++) {
        const each = cardsForRound(round, playerCount);
        assert.ok(each >= 1 && each * playerCount <= 52);
      }
    }
  });

  it('never shows one player another player’s cards, at any point', () => {
    const rng = seededRng(4242);
    let state = newMatch(6, 4242, { totalRounds: 6 });
    let guard = 0;

    while (state.status !== 'MATCH_END' && guard++ < 2000) {
      // Check the boundary on every single state, not just at the end.
      for (const viewer of state.players) {
        const view = viewJudgementFor(state, viewer.id);
        const text = JSON.stringify(view.players);
        for (const other of state.players) {
          if (other.id === viewer.id) continue;
          for (const held of other.hand) {
            assert.equal(
              text.includes(`"${held.id}"`),
              false,
              `${viewer.id} could see ${other.id} holding ${held.id}`,
            );
          }
        }
      }

      if (state.status === 'ROUND_END') {
        state = startNextRound(state, rng);
        continue;
      }
      const playerId = state.currentPlayerId;
      if (state.status === 'BIDDING') {
        const legal = legalBidsFor(state, playerId);
        state = (applyJudgementAction(state, { type: 'PLACE_BID', playerId, bid: legal[0]! }) as { state: JudgementState }).state;
      } else {
        const legal = legalCardIdsFor(state, playerId);
        state = (applyJudgementAction(state, { type: 'PLAY_CARD', playerId, cardId: legal[0]! }) as { state: JudgementState }).state;
      }
    }
    assert.equal(state.status, 'MATCH_END');
  });
});
