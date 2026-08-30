/**
 * The game catalogue: the only thing the room layer knows about a game.
 *
 * These run against the built shared package, which is what the server and the
 * client both consume.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_GAME,
  GAMES,
  GAME_IDS,
  describeGame,
  isGameId,
  teamForPosition,
  whyCannotStart,
} from '../../../packages/shared/dist/index.js';

describe('the game catalogue', () => {
  it('describes every game it lists', () => {
    for (const id of GAME_IDS) {
      const game = describeGame(id);
      assert.equal(game.id, id);
      assert.ok(game.name, `${id} needs a name`);
      assert.ok(game.tagline, `${id} needs a tagline`);
    }
  });

  it('keeps each game’s player counts coherent', () => {
    for (const game of Object.values(GAMES)) {
      assert.ok(game.startCounts.length > 0, `${game.id} must be startable`);
      // Ascending, so the "how many more" message reads in order.
      const ascending = [...game.startCounts].sort((a, b) => a - b);
      assert.deepEqual(game.startCounts, ascending);
      // Nobody may join beyond a size the game can actually start with.
      assert.equal(Math.max(...game.startCounts), game.maxPlayers);
      // Two alternating teams need an even number of players.
      for (const count of game.startCounts) {
        assert.equal(count % 2, 0, `${game.id} cannot seat ${count} in two teams`);
      }
    }
  });

  it('names every seat at the table', () => {
    for (const game of Object.values(GAMES)) {
      for (let position = 0; position < game.maxPlayers; position++) {
        assert.ok(game.seatLabel(position, game.maxPlayers), `${game.id} seat ${position}`);
      }
    }
  });

  it('recognises its own ids and nothing else', () => {
    assert.equal(isGameId(DEFAULT_GAME), true);
    assert.equal(isGameId('mindi-but-not-yet'), false);
    assert.equal(isGameId(null), false);
    assert.equal(isGameId(4), false);
  });
});

describe('teams alternate around the table', () => {
  it('puts even positions on one side and odd on the other', () => {
    assert.equal(teamForPosition(0), 'TEAM_A');
    assert.equal(teamForPosition(1), 'TEAM_B');
    assert.equal(teamForPosition(2), 'TEAM_A');
    assert.equal(teamForPosition(7), 'TEAM_B');
  });

  it('splits every legal table evenly', () => {
    for (const game of Object.values(GAMES)) {
      for (const count of game.startCounts) {
        const teams = Array.from({ length: count }, (_, i) => teamForPosition(i));
        const a = teams.filter((t) => t === 'TEAM_A').length;
        assert.equal(a, count - a, `${game.id} at ${count} players is lopsided`);
      }
    }
  });
});

describe('why a match cannot start', () => {
  const bukharo = describeGame('bukharo');

  it('says nothing when it can', () => {
    assert.equal(whyCannotStart(bukharo, 4), null);
  });

  it('says how many more are needed', () => {
    assert.equal(
      whyCannotStart(bukharo, 3),
      'Bukharo needs 4 players. You have 3 — 1 more to go.',
    );
    assert.match(whyCannotStart(bukharo, 1), /3 more to go/);
  });

  it('offers each option when a game has several table sizes', () => {
    // Shaped like Mindi, to pin the wording before that game exists.
    const manySizes = { ...bukharo, name: 'Mindi', maxPlayers: 8, startCounts: [4, 6, 8] };
    assert.equal(
      whyCannotStart(manySizes, 5),
      'Mindi needs 4, 6 or 8 players. You have 5 — 1 more to play 6, or 3 more to play 8.',
    );
    assert.equal(
      whyCannotStart(manySizes, 7),
      'Mindi needs 4, 6 or 8 players. You have 7 — 1 more to play 8.',
    );
    assert.equal(whyCannotStart(manySizes, 4), null);
    assert.equal(whyCannotStart(manySizes, 6), null);
    assert.equal(whyCannotStart(manySizes, 8), null);
  });

  it('says so when the table is already as big as it gets', () => {
    assert.match(whyCannotStart(bukharo, 5), /seats at most 4/);
  });
});

describe('teams belong to the game, not the platform', () => {
  it('still seats Bukharo and Mindi in two teams', () => {
    for (const id of ['bukharo', 'mindi']) {
      assert.equal(GAMES[id].hasTeams, true, `${id} is a partnership game`);
    }
  });

  it('alternates seats, so the players either side of you are opponents', () => {
    assert.equal(teamForPosition(0), 'TEAM_A');
    assert.equal(teamForPosition(1), 'TEAM_B');
    assert.equal(teamForPosition(2), 'TEAM_A');
    assert.equal(teamForPosition(3), 'TEAM_B');
  });

  it('describes every game as either having teams or not', () => {
    // A new game must answer this rather than inheriting an assumption.
    for (const id of GAME_IDS) {
      assert.equal(
        typeof GAMES[id].hasTeams,
        'boolean',
        `${id} does not say whether it is played in teams`,
      );
    }
  });
});
