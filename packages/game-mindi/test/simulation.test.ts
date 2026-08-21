import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDeck, countMindis } from '../src/cards.js';
import { allCards, applyMindiAction, startNextHand } from '../src/engine.js';
import { seededRng, type Rng } from '../src/random.js';
import { viewMindiFor } from '../src/view.js';
import type { MindiState } from '../src/types.js';
import { newMatch, rules } from './helpers.js';

const RULES = rules();

function assertNoCardsLostOrCloned(state: MindiState, context: string): void {
  const expected = buildDeck(state.players.length);
  const cards = allCards(state);
  assert.equal(cards.length, expected.length, `${context}: expected ${expected.length} cards`);
  assert.equal(new Set(cards.map((c) => c.id)).size, expected.length, `${context}: duplicate ids`);
}

/**
 * A player who only ever makes legal moves and otherwise has no idea what it
 * is doing. That is the point: it wanders into corners of the rules that a
 * sensible player would avoid.
 */
function botTurn(state: MindiState, rng: Rng): MindiState {
  if (state.status === 'CHOOSING_MODE') {
    const mode = rng.nextInt(2) === 0 ? 'HIDDEN' : 'KATTE';
    const result = applyMindiAction(state, { type: 'CHOOSE_MODE', playerId: state.chooserId, mode }, RULES, rng);
    assert.equal(result.ok, true, 'choosing a mode should always be allowed');
    return result.ok ? result.state : state;
  }

  const playerId = state.currentPlayerId;
  const player = state.players.find((p) => p.id === playerId)!;
  const leadSuit = state.currentTrick.leadSuit;
  const canFollow = leadSuit !== null && player.hand.some((c) => c.suit === leadSuit);

  // Being void is the only chance to ask for the hidden card, and the bot
  // takes it about half the time so both branches get exercised.
  let current = state;
  if (!canFollow && leadSuit !== null && rng.nextInt(2) === 0) {
    const reveal = applyMindiAction(current, { type: 'REVEAL_TRUMP', playerId }, RULES, rng);
    if (reveal.ok) current = reveal.state;
  }

  const hand = current.players.find((p) => p.id === playerId)!.hand;
  const legal = (() => {
    const lead = current.currentTrick.leadSuit;
    const following = lead ? hand.filter((c) => c.suit === lead) : [];
    if (following.length > 0) return following;
    // Whoever asked for the trump must then play it if they hold any.
    if (current.mustPlayTrumpBy === playerId && current.trumpSuit) {
      const trumps = hand.filter((c) => c.suit === current.trumpSuit);
      if (trumps.length > 0) return trumps;
    }
    return hand;
  })();

  // The hidden card comes back when it is all that is left, so an empty hand
  // here is legitimate for the chooser.
  if (legal.length === 0) {
    const forced = applyMindiAction(
      current,
      { type: 'PLAY_CARD', playerId, cardId: current.hiddenCard?.id ?? 'none' },
      RULES,
      rng,
    );
    assert.equal(forced.ok, true, 'the chooser should always have their hidden card to fall back on');
    return forced.ok ? forced.state : current;
  }

  const chosen = legal[rng.nextInt(legal.length)]!;
  const result = applyMindiAction(current, { type: 'PLAY_CARD', playerId, cardId: chosen.id }, RULES, rng);
  assert.equal(result.ok, true, `a legal card was refused: ${result.ok ? '' : result.message}`);
  return result.ok ? result.state : current;
}

function playHand(state: MindiState, rng: Rng): MindiState {
  let current = state;
  let guard = 0;
  while (current.status === 'PLAYING' || current.status === 'CHOOSING_MODE') {
    current = botTurn(current, rng);
    assertNoCardsLostOrCloned(current, `hand ${current.handNumber}`);
    assert.ok(guard++ < 500, 'a hand should not run forever');
  }
  return current;
}

describe('simulated hands (§94-style)', () => {
  it('plays whole hands at every table size without losing a card', () => {
    for (const players of [4, 6, 8]) {
      for (let seed = 1; seed <= 4; seed++) {
        const rng = seededRng(seed * 977 + players);
        let state = newMatch(players, seed);
        assertNoCardsLostOrCloned(state, `${players}p deal`);

        state = playHand(state, rng);

        assert.ok(
          state.status === 'HAND_END' || state.status === 'MATCH_END',
          `${players}p seed ${seed} ended in ${state.status}`,
        );

        // Every card was played exactly once, so every trick was full.
        const perPlayer = buildDeck(players).length / players;
        assert.equal(state.completedTricks.length, perPlayer);
        for (const trick of state.completedTricks) {
          assert.equal(trick.plays.length, players, 'every trick holds one card per player');
        }

        // Every Mindi in the deck found an owner.
        const dealt = countMindis(buildDeck(players));
        const captured = state.teams.TEAM_A.mindisThisHand + state.teams.TEAM_B.mindisThisHand;
        assert.equal(captured, dealt, `${players}p seed ${seed}: Mindis went missing`);

        // And the tricks add up.
        const tricks = state.teams.TEAM_A.tricksThisHand + state.teams.TEAM_B.tricksThisHand;
        assert.equal(tricks, perPlayer);
      }
    }
  });

  it('never shows a player another hand, or an unrevealed trump', () => {
    const rng = seededRng(4242);
    let state = newMatch(6, 11);
    let guard = 0;

    while ((state.status === 'PLAYING' || state.status === 'CHOOSING_MODE') && guard++ < 500) {
      state = botTurn(state, rng);

      for (const viewer of state.players) {
        const serialised = JSON.stringify(viewMindiFor(state, viewer.id));

        for (const other of state.players) {
          if (other.id === viewer.id) continue;
          for (const hidden of other.hand) {
            assert.equal(serialised.includes(`"${hidden.id}"`), false, `leaked ${hidden.id}`);
          }
        }

        // The face-down trump belongs to the player who hid it and nobody else.
        if (state.hiddenCard && viewer.id !== state.chooserId) {
          assert.equal(
            serialised.includes(`"${state.hiddenCard.id}"`),
            false,
            'leaked the hidden trump',
          );
        }
      }
    }
  });

  it('plays hand after hand until a team collects the Kot target', () => {
    const rng = seededRng(31337);
    let state = newMatch(4, 5);
    let hands = 0;

    while (state.status !== 'MATCH_END' && hands < 400) {
      state = playHand(state, rng);
      hands++;
      if (state.status === 'HAND_END') state = startNextHand(state, RULES, rng);
    }

    assert.equal(state.status, 'MATCH_END', `no result after ${hands} hands`);
    assert.ok(state.losingTeamId, 'somebody must have reached the target');
    assert.equal(state.teams[state.losingTeamId!].kot, RULES.kotTarget);
    assert.equal(state.handHistory.length, hands);

    // Every hand produced a winner, and a Kot only ever moved on a sweep.
    for (const result of state.handHistory) {
      assert.ok(result.winningTeamId);
      const total = result.mindis.TEAM_A + result.mindis.TEAM_B;
      assert.equal(total, 4, 'a four-player hand holds four Mindis');
      if (result.sweep) assert.equal(Math.min(result.mindis.TEAM_A, result.mindis.TEAM_B), 0);
    }
  });
});
