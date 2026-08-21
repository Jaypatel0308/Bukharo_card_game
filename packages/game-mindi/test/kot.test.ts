import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startNextHand } from '../src/engine.js';
import { seededRng } from '../src/random.js';
import { applyOrThrow, card, newMatch, playTrick, rules, scenario } from './helpers.js';

/** A four-player state one trick from the end, with the tallies dictated. */
function lastTrick(tallies: { aMindis: number; bMindis: number; aTricks: number; bTricks: number }) {
  const game = newMatch(4);
  const state = scenario(game, {
    status: 'PLAYING',
    mode: 'KATTE',
    trumpSuit: 'spades',
    trumpActive: true,
    currentPlayerId: 'p1',
    hands: {
      p1: [card('5', 'hearts')],
      p2: [card('K', 'hearts')],
      p3: [card('3', 'hearts')],
      p4: [card('4', 'hearts')],
    },
  });
  state.teams.TEAM_A.mindisThisHand = tallies.aMindis;
  state.teams.TEAM_B.mindisThisHand = tallies.bMindis;
  state.teams.TEAM_A.tricksThisHand = tallies.aTricks;
  state.teams.TEAM_B.tricksThisHand = tallies.bTricks;
  return state;
}

/** p2 takes the final trick with the king, which is a Team B seat. */
function playOut(state: ReturnType<typeof lastTrick>) {
  return playTrick(state, [
    ['p1', card('5', 'hearts')],
    ['p2', card('K', 'hearts')],
    ['p3', card('3', 'hearts')],
    ['p4', card('4', 'hearts')],
  ]);
}

describe('winning a hand (§48–51)', () => {
  it('goes to whoever holds more Mindis', () => {
    const done = playOut(lastTrick({ aMindis: 3, bMindis: 1, aTricks: 6, bTricks: 6 }));
    const result = done.handHistory[0]!;
    assert.equal(result.winningTeamId, 'TEAM_A');
    assert.equal(result.decidedBy, 'MINDIS');
  });

  it('falls back to tricks when the Mindis split evenly (§50)', () => {
    // 2–2 on Mindis, and Team A has taken more tricks.
    const done = playOut(lastTrick({ aMindis: 2, bMindis: 2, aTricks: 8, bTricks: 4 }));
    const result = done.handHistory[0]!;
    assert.equal(result.winningTeamId, 'TEAM_A');
    assert.equal(result.decidedBy, 'TRICKS');
  });

  it('always reaches a decision, because the trick count is odd', () => {
    // 13, 17 and 13 tricks: an even split of tricks is arithmetically
    // impossible, so the tiebreaker can never itself tie.
    for (const players of [4, 6, 8]) {
      const state = newMatch(players);
      const perPlayer = state.players[0]!.hand.length;
      assert.equal(perPlayer % 2, 1, `${players} players deal ${perPlayer} tricks`);
    }
  });
});

describe('Kot (§52–58)', () => {
  it('gives a Kot to a team swept of every Mindi', () => {
    // Team B takes the last trick and with it every Mindi in the hand.
    const done = playOut(lastTrick({ aMindis: 0, bMindis: 4, aTricks: 6, bTricks: 6 }));
    assert.equal(done.handHistory[0]!.sweep, true);
    assert.equal(done.teams.TEAM_A.kot, 1);
    assert.equal(done.teams.TEAM_B.kot, 0);
  });

  it('takes one off the sweeping team’s own tally (§56)', () => {
    const state = lastTrick({ aMindis: 0, bMindis: 4, aTricks: 6, bTricks: 6 });
    state.teams.TEAM_B.kot = 3;
    const done = playOut(state);
    assert.equal(done.teams.TEAM_B.kot, 2);
    assert.equal(done.teams.TEAM_A.kot, 1);
  });

  it('never lets a tally fall below zero (§57)', () => {
    const state = lastTrick({ aMindis: 0, bMindis: 4, aTricks: 6, bTricks: 6 });
    state.teams.TEAM_B.kot = 0;
    const done = playOut(state);
    assert.equal(done.teams.TEAM_B.kot, 0);
    assert.equal(done.teams.TEAM_A.kot, 1);
  });

  it('reproduces the worked example (§58)', () => {
    // Before: A has 2, B has 1. B sweeps.
    const state = lastTrick({ aMindis: 0, bMindis: 4, aTricks: 6, bTricks: 6 });
    state.teams.TEAM_A.kot = 2;
    state.teams.TEAM_B.kot = 1;
    const done = playOut(state);
    assert.equal(done.teams.TEAM_A.kot, 3);
    assert.equal(done.teams.TEAM_B.kot, 0);
  });

  it('leaves the tally alone when the Mindis are shared out', () => {
    const state = lastTrick({ aMindis: 1, bMindis: 3, aTricks: 6, bTricks: 6 });
    state.teams.TEAM_A.kot = 1;
    const done = playOut(state);
    assert.equal(done.handHistory[0]!.sweep, false);
    assert.equal(done.teams.TEAM_A.kot, 1);
    assert.equal(done.teams.TEAM_B.kot, 0);
  });
});

describe('ending the match', () => {
  it('ends it when a team reaches the Kot target, and that team loses', () => {
    const state = lastTrick({ aMindis: 0, bMindis: 4, aTricks: 6, bTricks: 6 });
    state.teams.TEAM_A.kot = 2; // one more sweep against them ends it
    const done = playOut(state);

    assert.equal(done.teams.TEAM_A.kot, 3);
    assert.equal(done.status, 'MATCH_END');
    assert.equal(done.losingTeamId, 'TEAM_A');
  });

  it('carries on when nobody has reached it yet', () => {
    const done = playOut(lastTrick({ aMindis: 1, bMindis: 3, aTricks: 6, bTricks: 6 }));
    assert.equal(done.status, 'HAND_END');
    assert.equal(done.losingTeamId, null);
  });

  it('respects a different target', () => {
    const state = lastTrick({ aMindis: 0, bMindis: 4, aTricks: 6, bTricks: 6 });
    const houseRules = rules({ kotTarget: 1 });
    const done = playTrick(
      state,
      [
        ['p1', card('5', 'hearts')],
        ['p2', card('K', 'hearts')],
        ['p3', card('3', 'hearts')],
        ['p4', card('4', 'hearts')],
      ],
      houseRules,
    );
    assert.equal(done.status, 'MATCH_END');
    assert.equal(done.losingTeamId, 'TEAM_A');
  });
});

describe('the next hand (§8, §14, §59)', () => {
  it('hands the deal to the losers and the choice to the winners', () => {
    const done = playOut(lastTrick({ aMindis: 1, bMindis: 3, aTricks: 6, bTricks: 6 }));
    const result = done.handHistory[0]!;
    assert.equal(result.winningTeamId, 'TEAM_B');

    const dealer = done.players.find((p) => p.id === done.dealerId)!;
    const chooser = done.players.find((p) => p.id === done.chooserId)!;
    assert.equal(dealer.teamId, 'TEAM_A', 'the losing team deals');
    assert.equal(chooser.teamId, 'TEAM_B', 'a winner picks how trump is set');
  });

  it('deals a fresh hand and clears the last one', () => {
    const done = playOut(lastTrick({ aMindis: 1, bMindis: 3, aTricks: 6, bTricks: 6 }));
    const next = startNextHand(done, rules(), seededRng(9));

    assert.equal(next.handNumber, 2);
    assert.equal(next.status, 'CHOOSING_MODE');
    assert.equal(next.mode, null);
    assert.equal(next.trumpSuit, null);
    assert.equal(next.hiddenCard, null);
    assert.equal(next.completedTricks.length, 0);
    assert.equal(next.teams.TEAM_A.mindisThisHand, 0);
    assert.equal(next.teams.TEAM_B.tricksThisHand, 0);
    for (const player of next.players) assert.equal(player.hand.length, 13);
    // The running tally survives.
    assert.equal(next.handHistory.length, 1);
  });

  it('starts the lead to the dealer’s left (§9, §60)', () => {
    const done = playOut(lastTrick({ aMindis: 1, bMindis: 3, aTricks: 6, bTricks: 6 }));
    const next = startNextHand(done, rules(), seededRng(9));
    const order = [...next.players].sort((a, b) => a.position - b.position);
    const dealerIndex = order.findIndex((p) => p.id === next.dealerId);
    assert.equal(next.currentPlayerId, order[(dealerIndex + 1) % order.length]!.id);
  });

  it('refuses a move once the hand is over', () => {
    const done = playOut(lastTrick({ aMindis: 1, bMindis: 3, aTricks: 6, bTricks: 6 }));
    assert.throws(
      () => applyOrThrow(done, { type: 'PLAY_CARD', playerId: done.currentPlayerId, cardId: 'anything' }),
      /GAME_NOT_PLAYING/,
    );
  });
});
