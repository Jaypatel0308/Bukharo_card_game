import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  forceSkipTurn,
  legalBidsFor,
  legalCardIdsFor,
  winnerOfTrick,
} from '../src/engine.js';
import { rankValue } from '../src/cards.js';
import { viewJudgementFor } from '../src/view.js';
import { applyOrThrow, bidAll, newMatch, nextRound, playOutRound, refuse } from './helpers.js';
import type { Card, Suit } from '../src/types.js';

const card = (rank: string, suit: Suit): Card => ({
  id: `${suit[0]}${rank}`,
  rank: rank as Card['rank'],
  suit,
});

describe('bidding (§24–32)', () => {
  it('starts with the designated player and goes round', () => {
    const state = newMatch(4);
    assert.equal(state.status, 'BIDDING');
    assert.equal(state.currentPlayerId, state.startingPlayerId);
  });

  it('refuses a bid out of turn', () => {
    const state = newMatch(4);
    const notThem = state.players.find((p) => p.id !== state.currentPlayerId)!;
    const result = refuse(state, { type: 'PLACE_BID', playerId: notThem.id, bid: 0 });
    assert.equal(result.code, 'NOT_YOUR_TURN');
  });

  it('refuses a bid larger than the tricks available', () => {
    const state = newMatch(4); // round one is a single card
    const result = refuse(state, {
      type: 'PLACE_BID',
      playerId: state.currentPlayerId,
      bid: 2,
    });
    assert.equal(result.code, 'BAD_BID');
  });

  it('stops the last bidder making the bids add up (§27)', () => {
    // Four players, round 5 has five cards. Get there first.
    let state = newMatch(4, 7);
    for (let round = 1; round < 5; round++) {
      state = bidAll(state);
      state = playOutRound(state);
      state = nextRound(state);
    }
    assert.equal(state.cardsEach, 5);

    // Three bids totalling 3, so the fourth may not judge 2.
    state = applyOrThrow(state, { type: 'PLACE_BID', playerId: state.currentPlayerId, bid: 1 });
    state = applyOrThrow(state, { type: 'PLACE_BID', playerId: state.currentPlayerId, bid: 2 });
    state = applyOrThrow(state, { type: 'PLACE_BID', playerId: state.currentPlayerId, bid: 0 });

    const result = refuse(state, { type: 'PLACE_BID', playerId: state.currentPlayerId, bid: 2 });
    assert.equal(result.code, 'BID_COMPLETES_COUNT');

    // Everything else is fine.
    for (const bid of [0, 1, 3, 4, 5]) {
      const attempt = applyOrThrow(state, {
        type: 'PLACE_BID',
        playerId: state.currentPlayerId,
        bid,
      });
      assert.equal(attempt.status, 'PLAYING', `judging ${bid} should have been allowed`);
    }
  });

  it('leads with the first bidder once everyone has judged (§32)', () => {
    const state = bidAll(newMatch(4));
    assert.equal(state.status, 'PLAYING');
    assert.equal(state.currentPlayerId, state.startingPlayerId);
  });
});

describe('following suit (§33–36)', () => {
  it('offers only the lead suit when you hold it', () => {
    let state = bidAll(newMatch(4, 3));
    const leader = state.currentPlayerId;
    const led = state.players.find((p) => p.id === leader)!.hand[0]!;
    state = applyOrThrow(state, { type: 'PLAY_CARD', playerId: leader, cardId: led.id });

    const next = state.players.find((p) => p.id === state.currentPlayerId)!;
    const holds = next.hand.filter((c) => c.suit === led.suit);
    const legal = legalCardIdsFor(state, next.id);
    if (holds.length > 0) {
      assert.deepEqual(legal.sort(), holds.map((c) => c.id).sort());
    } else {
      assert.equal(legal.length, next.hand.length, 'with none of the suit, anything goes');
    }
  });

  it('never makes you trump when you cannot follow (§36)', () => {
    // A hand with no hearts must still be allowed to discard rather than trump.
    let state = bidAll(newMatch(4, 11));
    const leader = state.currentPlayerId;
    const led = state.players.find((p) => p.id === leader)!.hand[0]!;
    state = applyOrThrow(state, { type: 'PLAY_CARD', playerId: leader, cardId: led.id });

    const next = state.players.find((p) => p.id === state.currentPlayerId)!;
    if (next.hand.some((c) => c.suit === led.suit)) return; // not the case under test
    const legal = legalCardIdsFor(state, next.id);
    assert.equal(legal.length, next.hand.length, 'every card should still be playable');
  });
});

describe('who takes the trick (§37–39)', () => {
  it('gives it to the highest of the lead suit when no trump is played', () => {
    const plays = [
      { playerId: 'a', card: card('5', 'clubs') },
      { playerId: 'b', card: card('K', 'clubs') },
      { playerId: 'c', card: card('A', 'hearts') },
      { playerId: 'd', card: card('J', 'clubs') },
    ];
    // Clubs led, diamonds trump: the ace of hearts cannot win.
    assert.equal(winnerOfTrick(plays, 'clubs', 'diamonds'), 'b');
  });

  it('lets any trump beat any plain card (§38)', () => {
    const plays = [
      { playerId: 'a', card: card('A', 'spades') },
      { playerId: 'b', card: card('4', 'diamonds') },
      { playerId: 'c', card: card('K', 'spades') },
      { playerId: 'd', card: card('3', 'spades') },
    ];
    assert.equal(winnerOfTrick(plays, 'spades', 'diamonds'), 'b');
  });

  it('gives it to the highest trump when several are played (§39)', () => {
    const plays = [
      { playerId: 'a', card: card('A', 'spades') },
      { playerId: 'b', card: card('4', 'diamonds') },
      { playerId: 'c', card: card('J', 'diamonds') },
      { playerId: 'd', card: card('K', 'spades') },
    ];
    assert.equal(winnerOfTrick(plays, 'spades', 'diamonds'), 'c');
  });

  it('ignores a card that is neither trump nor the suit led', () => {
    const plays = [
      { playerId: 'a', card: card('2', 'clubs') },
      { playerId: 'b', card: card('A', 'hearts') },
      { playerId: 'c', card: card('A', 'spades') },
    ];
    assert.equal(winnerOfTrick(plays, 'clubs', 'diamonds'), 'a');
  });
});

describe('what a player is shown', () => {
  it('shows you your hand and nobody else theirs', () => {
    const state = bidAll(newMatch(4));
    const view = viewJudgementFor(state, 'p1');
    assert.equal(view.you!.hand.length, state.cardsEach);
    for (const player of view.players) {
      assert.equal('hand' in player, false, `${player.id}'s cards leaked`);
    }
  });

  it('never sends the cards left aside at the deal (§19)', () => {
    // Six players, round 8: eight each leaves four undealt.
    let state = newMatch(6, 5);
    for (let round = 1; round < 8; round++) {
      state = bidAll(state);
      state = playOutRound(state);
      state = nextRound(state);
    }
    assert.equal(state.cardsEach, 8);
    assert.equal(state.undealt.length, 4, 'four cards should be set aside');

    // The view has no such field at all, so there is nothing to leak.
    const view = viewJudgementFor(state, 'p1');
    assert.equal('undealt' in view, false, 'the view should not carry the spare cards');

    // And none of them is in anybody's hand or on the table this round.
    const spare = new Set(state.undealt.map((c) => c.id));
    for (const player of state.players) {
      for (const held of player.hand) {
        assert.equal(spare.has(held.id), false, `${held.id} was both dealt and set aside`);
      }
    }
    for (const play of state.currentTrick.plays) {
      assert.equal(spare.has(play.card.id), false, 'a card set aside was played');
    }

    // Every card is accounted for exactly once.
    const all = [
      ...state.undealt.map((c) => c.id),
      ...state.players.flatMap((p) => p.hand.map((c) => c.id)),
    ];
    assert.equal(new Set(all).size, 52, 'the deal should account for all 52 cards');
  });

  it('makes every judgement public, since the game turns on reading them (§64)', () => {
    const state = bidAll(newMatch(4));
    const view = viewJudgementFor(state, 'p1');
    for (const player of view.players) {
      assert.notEqual(player.bid, null, `${player.id}'s judgement should be visible`);
    }
  });
});

describe('playing for someone who has gone', () => {
  it('judges the lowest legal number for them', () => {
    const state = newMatch(4);
    const absent = state.currentPlayerId;
    const after = forceSkipTurn(state, 'disconnected');

    const them = after.players.find((p) => p.id === absent)!;
    assert.equal(them.bid, 0, 'the least consequential judgement is nothing');
    assert.notEqual(after.currentPlayerId, absent, 'the turn moved on');
  });

  it('respects the last-bidder rule even when forced (§27, §30)', () => {
    // One trick, and the first three all judged nothing. The forbidden number
    // is 1, so nothing is still legal for the last player — exactly the case
    // the rulebook works through in §30.
    let state = newMatch(4);
    for (let i = 0; i < 3; i++) {
      state = applyOrThrow(state, { type: 'PLACE_BID', playerId: state.currentPlayerId, bid: 0 });
    }
    const last = state.currentPlayerId;
    assert.deepEqual(legalBidsFor(state, last), [0], 'only nothing is left to judge');

    const after = forceSkipTurn(state, 'disconnected');
    assert.equal(after.players.find((p) => p.id === last)!.bid, 0);
    const total = after.players.reduce((sum, p) => sum + (p.bid ?? 0), 0);
    assert.notEqual(total, after.cardsEach, 'the bids must never add up');
  });

  it('steps past the forbidden number when it has to', () => {
    // Three tricks and the others judged three between them, so nothing is
    // forbidden for the last player and a forced bid must climb to one (§29).
    let state = newMatch(4, 5);
    for (let round = 1; round < 3; round++) {
      state = bidAll(state);
      state = playOutRound(state);
      state = nextRound(state);
    }
    assert.equal(state.cardsEach, 3);
    for (const bid of [1, 1, 1]) {
      state = applyOrThrow(state, { type: 'PLACE_BID', playerId: state.currentPlayerId, bid });
    }
    const last = state.currentPlayerId;
    assert.equal(legalBidsFor(state, last).includes(0), false, 'nothing is forbidden here');

    const after = forceSkipTurn(state, 'disconnected');
    const forced = after.players.find((p) => p.id === last)!.bid;
    assert.equal(forced, 1, 'the lowest number still legal');
    assert.notEqual(
      after.players.reduce((sum, p) => sum + (p.bid ?? 0), 0),
      after.cardsEach,
    );
  });

  it('plays their lowest legal card', () => {
    const state = bidAll(newMatch(4, 9));
    const absent = state.currentPlayerId;
    const hand = state.players.find((p) => p.id === absent)!.hand;
    const legal = legalCardIdsFor(state, absent);
    const lowest = hand
      .filter((c) => legal.includes(c.id))
      .sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0]!;

    const after = forceSkipTurn(state, 'disconnected');
    const played = after.currentTrick.plays.find((p) => p.playerId === absent);
    assert.ok(played, 'a card should have been played for them');
    assert.equal(played.card.id, lowest.id, 'and it should be their least useful one');
  });

  it('still follows suit when playing for them', () => {
    let state = bidAll(newMatch(4, 21));
    const leader = state.currentPlayerId;
    const led = state.players.find((p) => p.id === leader)!.hand[0]!;
    state = applyOrThrow(state, { type: 'PLAY_CARD', playerId: leader, cardId: led.id });

    const absent = state.currentPlayerId;
    const hand = state.players.find((p) => p.id === absent)!.hand;
    const after = forceSkipTurn(state, 'disconnected');
    const played = after.currentTrick.plays.find((p) => p.playerId === absent)!;

    if (hand.some((c) => c.suit === led.suit)) {
      assert.equal(played.card.suit, led.suit, 'a forced play must follow suit too');
    }
  });
});
