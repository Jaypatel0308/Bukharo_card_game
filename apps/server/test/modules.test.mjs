/**
 * The contract between a room and a game.
 *
 * Every module must honour the same shape, and must use the settings it is
 * given rather than its own defaults — a forced play can finish a hand, and
 * finishing a hand needs to know what the match is played to.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { moduleFor, isPlayableGame } from '../dist/games/index.js';
import { GAME_IDS } from '../../../packages/shared/dist/index.js';

const seats = (count) =>
  Array.from({ length: count }, (_, position) => ({
    id: `p${position + 1}`,
    displayName: `P${position + 1}`,
    position,
  }));

describe('every game module', () => {
  it('exists for every game the catalogue offers', () => {
    for (const id of GAME_IDS) {
      assert.ok(isPlayableGame(id), `${id} has no module`);
      assert.equal(moduleFor(id).id, id);
    }
  });

  it('refuses a game it does not know, by name', () => {
    assert.throws(() => moduleFor('solitaire'), /No module is registered for the game "solitaire"/);
    assert.equal(isPlayableGame('solitaire'), false);
  });

  it('implements the whole contract', () => {
    const required = [
      'settingsFor',
      'createMatch',
      'startNextRound',
      'parseAction',
      'applyAction',
      'viewFor',
      'phaseOf',
      'currentPlayerId',
      'skipCurrentPlayer',
      'renameTeam',
      'stampLog',
    ];
    for (const id of GAME_IDS) {
      const module = moduleFor(id);
      for (const method of required) {
        assert.equal(typeof module[method], 'function', `${id} is missing ${method}`);
      }
    }
  });

  it('tags its view with its own id, and hands out no other hand', () => {
    for (const [id, count] of [['bukharo', 4], ['mindi', 4]]) {
      const module = moduleFor(id);
      const settings = module.settingsFor(3);
      const state = module.createMatch(
        { roomId: 'r', seats: seats(count), target: 3, teamNames: {} },
        settings,
      );

      const snapshot = module.viewFor(state, 'p1');
      assert.equal(snapshot.gameId, id);
      assert.ok(snapshot.view.you, `${id} should show p1 their own hand`);
      for (const other of snapshot.view.players.filter((p) => p.id !== 'p1')) {
        assert.equal('hand' in other, false, `${id} exposed another hand`);
      }
    }
  });

  it('refuses an action belonging to the other game', () => {
    assert.equal(moduleFor('mindi').parseAction({ type: 'DRAW_STOCK' }, 'p1'), null);
    assert.equal(moduleFor('bukharo').parseAction({ type: 'PLAY_CARD', cardId: 'x' }, 'p1'), null);
    for (const id of GAME_IDS) {
      assert.equal(moduleFor(id).parseAction(null, 'p1'), null);
      assert.equal(moduleFor(id).parseAction({ type: 'NONSENSE' }, 'p1'), null);
    }
  });

  it('uses the settings it is handed, not its own defaults', () => {
    // Mindi at a Kot target of 1: a forced play that finishes a hand must end
    // the match, which it cannot do if the module falls back to a default of 3.
    const module = moduleFor('mindi');
    const settings = module.settingsFor(1);
    assert.equal(settings.kotTarget, 1);

    let state = module.createMatch(
      { roomId: 'r', seats: seats(4), target: 1, teamNames: {} },
      settings,
    );

    // Play the whole hand by forcing every turn, which is the path that used
    // to reach for the defaults.
    let guard = 0;
    while (module.phaseOf(state) === 'PLAYING' && guard++ < 200) {
      state = module.skipCurrentPlayer(state, 'test', settings);
    }

    assert.ok(guard < 200, 'forcing every turn should finish the hand');
    const phase = module.phaseOf(state);
    assert.ok(phase === 'ROUND_END' || phase === 'MATCH_END');

    // Whatever happened, the tally was judged against the target given.
    const view = module.viewFor(state, 'p1').view;
    assert.equal(view.kotTarget, 1);
  });
});
