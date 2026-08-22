import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { forceSkipTurn } from '../src/engine.js';
import { card, newMatch, rules, scenario } from './helpers.js';

/**
 * Getting past a player who has gone.
 *
 * A trick needs a card from everybody, so this cannot mean passing the turn:
 * it means playing for them. That is a real decision about somebody else's
 * hand, so it is made as narrowly as possible — the lowest legal card — and
 * only when the room asks.
 */
describe('a player who has gone', () => {
  it('has their lowest legal card played for them', () => {
    const state = scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'KATTE',
      trumpSuit: 'spades',
      trumpActive: true,
      currentPlayerId: 'p2',
      hands: { p2: [card('K', 'hearts'), card('3', 'hearts'), card('A', 'spades')] },
    });
    const led = scenario(state, { currentPlayerId: 'p1', hands: { p1: [card('5', 'hearts')] } });
    const withLead = forceSkipTurn(led, 'disconnected', rules());

    // p1 was on lead and had one card, so that is what went down.
    assert.equal(withLead.currentTrick.plays.length, 1);
    assert.equal(withLead.currentTrick.plays[0]!.card.id, card('5', 'hearts').id);

    // p2 must follow hearts, and the three is lower than the king.
    const next = forceSkipTurn(withLead, 'disconnected', rules());
    assert.equal(next.currentTrick.plays[1]!.card.id, card('3', 'hearts').id);
  });

  it('follows suit when playing for them, rather than dumping anything', () => {
    const state = scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: {
        p1: [card('9', 'hearts')],
        p2: [card('2', 'clubs'), card('4', 'hearts')],
      },
    });
    let done = forceSkipTurn(state, 'disconnected', rules());
    done = forceSkipTurn(done, 'disconnected', rules());

    // The club is lower, but hearts were led and p2 holds one.
    assert.equal(done.currentTrick.plays[1]!.card.suit, 'hearts');
  });

  it('settles an unmade trump choice as Katte, which hides nothing', () => {
    const game = newMatch(4);
    assert.equal(game.status, 'CHOOSING_MODE');

    const done = forceSkipTurn(game, 'disconnected', rules());
    assert.equal(done.mode, 'KATTE');
    assert.equal(done.status, 'PLAYING');
    assert.equal(done.hiddenCard, null, 'an absent player must not be left holding a secret');
    assert.match(done.log.at(-1)!.message, /played as Katte/);
  });

  it('says in the log that a card was played on someone’s behalf', () => {
    const state = scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'KATTE',
      currentPlayerId: 'p1',
      hands: { p1: [card('9', 'hearts')] },
    });
    const done = forceSkipTurn(state, 'disconnected', rules());
    assert.match(done.log.at(-1)!.message, /played for them/);
  });

  it('leaves a finished hand alone', () => {
    const game = newMatch(4);
    const over = scenario(game, { status: 'HAND_END' });
    assert.equal(forceSkipTurn(over, 'disconnected', rules()), over);
  });
});
