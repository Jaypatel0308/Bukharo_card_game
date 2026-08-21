import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyMindiAction } from '../src/engine.js';
import { seededRng } from '../src/random.js';
import { buildDeck, cardsPerPlayer, countMindis } from '../src/cards.js';
import { applyOrThrow, card, newMatch, playTrick, rules, scenario } from './helpers.js';

describe('the deck (§2)', () => {
  it('deals one deck to four players, thirteen each, four Mindis', () => {
    const deck = buildDeck(4);
    assert.equal(deck.length, 52);
    assert.equal(cardsPerPlayer(4), 13);
    assert.equal(countMindis(deck), 4);
  });

  it('deals two decks less a 2♦ and a 2♣ to six, seventeen each, eight Mindis', () => {
    const deck = buildDeck(6);
    assert.equal(deck.length, 102);
    assert.equal(cardsPerPlayer(6), 17);
    assert.equal(countMindis(deck), 8);
    // Exactly one of each removed two survives.
    assert.equal(deck.filter((c) => c.rank === '2' && c.suit === 'diamonds').length, 1);
    assert.equal(deck.filter((c) => c.rank === '2' && c.suit === 'clubs').length, 1);
  });

  it('deals two whole decks to eight, thirteen each, eight Mindis', () => {
    const deck = buildDeck(8);
    assert.equal(deck.length, 104);
    assert.equal(cardsPerPlayer(8), 13);
    assert.equal(countMindis(deck), 8);
  });

  it('gives every physical card its own identity', () => {
    for (const count of [4, 6, 8]) {
      const deck = buildDeck(count);
      assert.equal(new Set(deck.map((c) => c.id)).size, deck.length);
    }
  });

  it('refuses a table size the game does not have', () => {
    assert.throws(() => buildDeck(5), /4, 6 or 8/);
  });

  it('leaves nobody short at any table size', () => {
    for (const count of [4, 6, 8]) {
      const state = newMatch(count);
      const sizes = new Set(state.players.map((p) => p.hand.length));
      assert.equal(sizes.size, 1, `hands differ at ${count} players`);
      assert.equal(state.players.length, count);
    }
  });
});

describe('following suit (§11)', () => {
  it('refuses another suit while you hold the one led', () => {
    const game = newMatch(4);
    const state = scenario(game, {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: {
        p1: [card('5', 'hearts')],
        p2: [card('A', 'spades'), card('3', 'hearts')],
      },
    });

    const led = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('5', 'hearts').id });
    const refused = applyMindiAction(
      led,
      { type: 'PLAY_CARD', playerId: 'p2', cardId: card('A', 'spades').id },
      rules(),
      seededRng(1),
    );

    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.code, 'MUST_FOLLOW_SUIT');
    assert.match(refused.ok === false ? refused.message : '', /you must play hearts/);
  });

  it('allows any card once you are void', () => {
    const game = newMatch(4);
    const state = scenario(game, {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: { p1: [card('5', 'hearts')], p2: [card('A', 'spades')] },
    });
    const led = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('5', 'hearts').id });
    const played = applyOrThrow(led, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('A', 'spades').id });
    assert.equal(played.currentTrick.plays.length, 2);
  });
});

describe('winning a trick', () => {
  function fourHanded(hands: Record<string, ReturnType<typeof card>[]>, extra = {}) {
    return scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands,
      ...extra,
    });
  }

  it('gives it to the highest card of the lead suit when there is no trump (§36)', () => {
    // A hidden hand before any reveal: the off-suit club is a plain discard,
    // not a Katte candidate, so nothing can beat the hearts.
    const state = fourHanded(
      {
        p1: [card('5', 'hearts')],
        p2: [card('K', 'hearts')],
        p3: [card('3', 'clubs')],
        p4: [card('A', 'hearts')],
      },
      { mode: 'HIDDEN', hiddenCard: card('9', 'spades'), hiddenRevealed: false },
    );
    const done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('K', 'hearts')],
      ['p3', card('3', 'clubs')],
      ['p4', card('A', 'hearts')],
    ]);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p4');
  });

  it('lets the lowest trump beat the highest plain card (§37)', () => {
    const state = fourHanded(
      {
        p1: [card('A', 'hearts')],
        p2: [card('K', 'hearts')],
        p3: [card('2', 'spades')],
        p4: [card('10', 'hearts')],
      },
      { trumpSuit: 'spades', trumpActive: true },
    );
    const done = playTrick(state, [
      ['p1', card('A', 'hearts')],
      ['p2', card('K', 'hearts')],
      ['p3', card('2', 'spades')],
      ['p4', card('10', 'hearts')],
    ]);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p3');
  });

  it('gives it to the highest trump when several appear (§38)', () => {
    const state = fourHanded(
      {
        p1: [card('A', 'clubs')],
        p2: [card('4', 'diamonds')],
        p3: [card('J', 'diamonds')],
        p4: [card('K', 'clubs')],
      },
      { trumpSuit: 'diamonds', trumpActive: true },
    );
    const done = playTrick(state, [
      ['p1', card('A', 'clubs')],
      ['p2', card('4', 'diamonds')],
      ['p3', card('J', 'diamonds')],
      ['p4', card('K', 'clubs')],
    ]);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p3');
  });

  it('does not let a plain off-suit card win (§39)', () => {
    const state = fourHanded(
      {
        p1: [card('7', 'hearts')],
        p2: [card('A', 'hearts')],
        p3: [card('K', 'clubs')],
        p4: [card('3', 'hearts')],
      },
      { trumpSuit: 'diamonds', trumpActive: true },
    );
    const done = playTrick(state, [
      ['p1', card('7', 'hearts')],
      ['p2', card('A', 'hearts')],
      ['p3', card('K', 'clubs')],
      ['p4', card('3', 'hearts')],
    ]);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p2');
  });

  it('does not promote a ten for being a Mindi (§3)', () => {
    const state = fourHanded({
      p1: [card('10', 'hearts')],
      p2: [card('J', 'hearts')],
      p3: [card('2', 'hearts')],
      p4: [card('3', 'hearts')],
    });
    const done = playTrick(state, [
      ['p1', card('10', 'hearts')],
      ['p2', card('J', 'hearts')],
      ['p3', card('2', 'hearts')],
      ['p4', card('3', 'hearts')],
    ]);
    // The jack takes it: a ten is only special for what it is worth at the end.
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p2');
  });
});

describe('two identical cards (§41)', () => {
  it('gives the trick to the later copy', () => {
    const state = scenario(newMatch(8), {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: {
        p1: [card('A', 'spades', 1)],
        p2: [card('7', 'spades', 1)],
        p3: [card('K', 'spades', 1)],
        p4: [card('A', 'spades', 2)],
        p5: [card('2', 'spades', 1)],
        p6: [card('3', 'spades', 1)],
        p7: [card('4', 'spades', 1)],
        p8: [card('5', 'spades', 1)],
      },
    });
    const done = playTrick(state, [
      ['p1', card('A', 'spades', 1)],
      ['p2', card('7', 'spades', 1)],
      ['p3', card('K', 'spades', 1)],
      ['p4', card('A', 'spades', 2)],
      ['p5', card('2', 'spades', 1)],
      ['p6', card('3', 'spades', 1)],
      ['p7', card('4', 'spades', 1)],
      ['p8', card('5', 'spades', 1)],
    ]);

    // §43 — how many cards fell between the two aces makes no difference.
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p4');
  });

  it('applies the same way to identical trumps (§44)', () => {
    const state = scenario(newMatch(8), {
      status: 'PLAYING',
      mode: 'KATTE',
      trumpSuit: 'hearts',
      trumpActive: true,
      currentPlayerId: 'p1',
      hands: {
        p1: [card('K', 'clubs')],
        p2: [card('A', 'hearts', 1)],
        p3: [card('2', 'clubs')],
        p4: [card('A', 'hearts', 2)],
        p5: [card('3', 'clubs')],
        p6: [card('4', 'clubs')],
        p7: [card('5', 'clubs')],
        p8: [card('6', 'clubs')],
      },
    });
    const done = playTrick(state, [
      ['p1', card('K', 'clubs')],
      ['p2', card('A', 'hearts', 1)],
      ['p3', card('2', 'clubs')],
      ['p4', card('A', 'hearts', 2)],
      ['p5', card('3', 'clubs')],
      ['p6', card('4', 'clubs')],
      ['p7', card('5', 'clubs')],
      ['p8', card('6', 'clubs')],
    ]);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p4');
  });
});

describe('capturing Mindis (§45)', () => {
  it('gives every ten in the trick to the team that won it', () => {
    const state = scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: {
        p1: [card('10', 'diamonds')],
        p2: [card('K', 'diamonds')],
        p3: [card('3', 'diamonds')],
        p4: [card('A', 'diamonds')],
      },
    });
    const done = playTrick(state, [
      ['p1', card('10', 'diamonds')],
      ['p2', card('K', 'diamonds')],
      ['p3', card('3', 'diamonds')],
      ['p4', card('A', 'diamonds')],
    ]);

    // p4 sits at position 3, so the Mindi goes to Team B even though p1 played it.
    assert.equal(done.completedTricks[0]!.winningTeamId, 'TEAM_B');
    assert.equal(done.teams.TEAM_B.mindisThisHand, 1);
    assert.equal(done.teams.TEAM_A.mindisThisHand, 0);
  });

  it('hands over several at once (§47)', () => {
    const state = scenario(newMatch(8), {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: {
        p1: [card('10', 'clubs', 1)],
        p2: [card('10', 'clubs', 2)],
        p3: [card('2', 'clubs')],
        p4: [card('A', 'clubs')],
        p5: [card('3', 'clubs')],
        p6: [card('4', 'clubs')],
        p7: [card('5', 'clubs')],
        p8: [card('6', 'clubs')],
      },
    });
    const done = playTrick(state, [
      ['p1', card('10', 'clubs', 1)],
      ['p2', card('10', 'clubs', 2)],
      ['p3', card('2', 'clubs')],
      ['p4', card('A', 'clubs')],
      ['p5', card('3', 'clubs')],
      ['p6', card('4', 'clubs')],
      ['p7', card('5', 'clubs')],
      ['p8', card('6', 'clubs')],
    ]);
    assert.equal(done.completedTricks[0]!.mindis, 2);
    assert.equal(done.teams.TEAM_B.mindisThisHand, 2);
  });
});

describe('leading (§9)', () => {
  it('passes the lead to whoever won the last trick', () => {
    const state = scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: {
        p1: [card('5', 'hearts'), card('2', 'clubs')],
        p2: [card('K', 'hearts'), card('3', 'clubs')],
        p3: [card('4', 'hearts'), card('4', 'clubs')],
        p4: [card('6', 'hearts'), card('5', 'clubs')],
      },
    });
    const done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('K', 'hearts')],
      ['p3', card('4', 'hearts')],
      ['p4', card('6', 'hearts')],
    ]);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p2');
    assert.equal(done.currentPlayerId, 'p2');
  });
});
