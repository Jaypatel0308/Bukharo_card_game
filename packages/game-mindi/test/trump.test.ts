import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyMindiAction } from '../src/engine.js';
import { seededRng } from '../src/random.js';
import { viewMindiFor } from '../src/view.js';
import { applyOrThrow, card, newMatch, playTrick, rules, scenario } from './helpers.js';

function refuse(state: Parameters<typeof applyMindiAction>[0], action: Parameters<typeof applyMindiAction>[1]) {
  const result = applyMindiAction(state, action, rules(), seededRng(1));
  assert.equal(result.ok, false, 'expected that to be refused');
  return result.ok === false ? result : null;
}

describe('Katte (§26–34)', () => {
  function katteTable(hands: Record<string, ReturnType<typeof card>[]>) {
    return scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'KATTE',
      trumpSuit: null,
      trumpActive: false,
      currentPlayerId: 'p1',
      hands,
    });
  }

  it('lets a single off-suit card set trump, and take the trick (§28)', () => {
    const state = katteTable({
      p1: [card('5', 'hearts')],
      p2: [card('7', 'diamonds')],
      p3: [card('8', 'hearts')],
      p4: [card('9', 'hearts')],
    });
    const done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('7', 'diamonds')],
      ['p3', card('8', 'hearts')],
      ['p4', card('9', 'hearts')],
    ]);

    assert.equal(done.trumpSuit, 'diamonds');
    assert.equal(done.trumpActive, true);
    // The 7♦ beats every heart, low as it is: it is the trump it just created.
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p2');
  });

  it('gives it to the higher candidate, played later (§30)', () => {
    const state = katteTable({
      p1: [card('5', 'hearts')],
      p2: [card('7', 'diamonds')],
      p3: [card('8', 'hearts')],
      p4: [card('8', 'clubs')],
    });
    const done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('7', 'diamonds')],
      ['p3', card('8', 'hearts')],
      ['p4', card('8', 'clubs')],
    ]);
    assert.equal(done.trumpSuit, 'clubs');
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p4');
  });

  it('gives it to the higher candidate, played earlier (§31)', () => {
    const state = katteTable({
      p1: [card('5', 'hearts')],
      p2: [card('K', 'diamonds')],
      p3: [card('8', 'hearts')],
      p4: [card('7', 'clubs')],
    });
    const done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('K', 'diamonds')],
      ['p3', card('8', 'hearts')],
      ['p4', card('7', 'clubs')],
    ]);
    // Coming later does not help the 7♣ against a king.
    assert.equal(done.trumpSuit, 'diamonds');
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p2');
  });

  it('breaks an equal-ranked tie in favour of the later card (§32)', () => {
    const state = katteTable({
      p1: [card('5', 'hearts')],
      p2: [card('7', 'diamonds')],
      p3: [card('8', 'hearts')],
      p4: [card('7', 'clubs')],
    });
    const done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('7', 'diamonds')],
      ['p3', card('8', 'hearts')],
      ['p4', card('7', 'clubs')],
    ]);
    assert.equal(done.trumpSuit, 'clubs');
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p4');
  });

  it('fixes trump for the rest of the hand (§34–35)', () => {
    const state = katteTable({
      p1: [card('5', 'hearts'), card('2', 'spades')],
      p2: [card('7', 'diamonds'), card('3', 'spades')],
      p3: [card('8', 'hearts'), card('K', 'clubs')],
      p4: [card('9', 'hearts'), card('4', 'spades')],
    });
    let done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('7', 'diamonds')],
      ['p3', card('8', 'hearts')],
      ['p4', card('9', 'hearts')],
    ]);
    assert.equal(done.trumpSuit, 'diamonds');

    // p2 leads spades; p3 is void and plays a club. That is no longer a
    // Katte contest, so diamonds stay trump and the spades decide it.
    done = playTrick(done, [
      ['p2', card('3', 'spades')],
      ['p3', card('K', 'clubs')],
      ['p4', card('4', 'spades')],
      ['p1', card('2', 'spades')],
    ]);
    assert.equal(done.trumpSuit, 'diamonds');
    assert.equal(done.completedTricks[1]!.winnerPlayerId, 'p4');
  });

  it('leaves the hand with no trump at all when nobody is ever void', () => {
    const state = katteTable({
      p1: [card('5', 'hearts')],
      p2: [card('K', 'hearts')],
      p3: [card('8', 'hearts')],
      p4: [card('9', 'hearts')],
    });
    const done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('K', 'hearts')],
      ['p3', card('8', 'hearts')],
      ['p4', card('9', 'hearts')],
    ]);
    assert.equal(done.trumpSuit, null);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p2');
  });
});

describe('Hidden Trump (§13–24)', () => {
  function hiddenTable(hands: Record<string, ReturnType<typeof card>[]>, hidden = card('9', 'spades')) {
    return scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'HIDDEN',
      trumpSuit: null,
      trumpActive: false,
      hiddenCard: hidden,
      hiddenRevealed: false,
      chooserId: 'p1',
      currentPlayerId: 'p1',
      hands,
    });
  }

  it('leaves the hidden suit powerless until it is turned over (§16, §64)', () => {
    const state = hiddenTable({
      p1: [card('10', 'hearts')],
      p2: [card('K', 'spades')],
      p3: [card('A', 'hearts')],
      p4: [card('4', 'hearts')],
    });
    const done = playTrick(state, [
      ['p1', card('10', 'hearts')],
      ['p2', card('K', 'spades')],
      ['p3', card('A', 'hearts')],
      ['p4', card('4', 'hearts')],
    ]);
    // Spades will be trump if anyone ever asks. Nobody has, so the ace wins.
    assert.equal(done.trumpSuit, null);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p3');
  });

  it('makes the suit trump the moment it is revealed, and returns the card (§21)', () => {
    const state = hiddenTable({
      p1: [card('10', 'hearts'), card('2', 'clubs')],
      p2: [card('K', 'spades'), card('3', 'spades')],
      p3: [card('A', 'hearts')],
      p4: [card('4', 'hearts')],
    });
    const led = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('10', 'hearts').id });

    const revealed = applyOrThrow(led, { type: 'REVEAL_TRUMP', playerId: 'p2' });
    assert.equal(revealed.trumpSuit, 'spades');
    assert.equal(revealed.trumpActive, true);
    assert.equal(revealed.hiddenCard, null);
    // §1 answer — the card goes back to the hand it was taken from.
    assert.ok(revealed.players.find((p) => p.id === 'p1')!.hand.some((c) => c.id === card('9', 'spades').id));
  });

  it('obliges the player who asked to play that suit (§22)', () => {
    const state = hiddenTable({
      p1: [card('10', 'hearts')],
      p2: [card('K', 'spades'), card('2', 'clubs')],
      p3: [card('A', 'hearts')],
      p4: [card('4', 'hearts')],
    });
    const led = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('10', 'hearts').id });
    const revealed = applyOrThrow(led, { type: 'REVEAL_TRUMP', playerId: 'p2' });

    const refused = refuse(revealed, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('2', 'clubs').id });
    assert.equal(refused?.code, 'MUST_PLAY_TRUMP');

    // Any spade will do, not the highest (§23).
    const played = applyOrThrow(revealed, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('K', 'spades').id });
    assert.equal(played.currentTrick.plays.length, 2);
  });

  it('lets them play anything when they hold none of it', () => {
    const state = hiddenTable({
      p1: [card('10', 'hearts')],
      p2: [card('2', 'clubs')],
      p3: [card('A', 'hearts')],
      p4: [card('4', 'hearts')],
    });
    const led = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('10', 'hearts').id });
    const revealed = applyOrThrow(led, { type: 'REVEAL_TRUMP', playerId: 'p2' });
    const played = applyOrThrow(revealed, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('2', 'clubs').id });
    assert.equal(played.currentTrick.plays.length, 2);
  });

  /**
   * The timing rule, and the one most likely to be got wrong: trump counts
   * only from the declaration, so a card of that suit already on the table
   * stays an ordinary card.
   */
  it('does not promote cards already played when the trump appears', () => {
    const state = hiddenTable({
      p1: [card('5', 'hearts')],
      p2: [card('A', 'spades')], // void, declines, discards a spade
      p3: [card('3', 'spades')], // void, asks — spades become trump
      p4: [card('4', 'hearts')],
    });
    let done = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('5', 'hearts').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('A', 'spades').id });
    done = applyOrThrow(done, { type: 'REVEAL_TRUMP', playerId: 'p3' });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p3', cardId: card('3', 'spades').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p4', cardId: card('4', 'hearts').id });

    // The ace of spades went down before spades meant anything, so the lowly
    // three that came after it takes the trick.
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p3');
  });

  it('promotes cards played after the declaration in the same trick', () => {
    const state = hiddenTable({
      p1: [card('5', 'hearts')],
      p2: [card('3', 'spades')], // asks, spades become trump
      p3: [card('A', 'hearts')],
      p4: [card('K', 'spades')], // void, plays a spade after the declaration
    });
    let done = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('5', 'hearts').id });
    done = applyOrThrow(done, { type: 'REVEAL_TRUMP', playerId: 'p2' });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('3', 'spades').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p3', cardId: card('A', 'hearts').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p4', cardId: card('K', 'spades').id });

    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p4');
  });

  it('refuses the reveal to someone who can still follow suit (§17)', () => {
    const state = hiddenTable({
      p1: [card('5', 'hearts')],
      p2: [card('K', 'hearts')],
      p3: [card('A', 'hearts')],
      p4: [card('4', 'hearts')],
    });
    const led = applyOrThrow(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('5', 'hearts').id });
    const refused = refuse(led, { type: 'REVEAL_TRUMP', playerId: 'p2' });
    assert.equal(refused?.code, 'CAN_STILL_FOLLOW_SUIT');
  });

  it('refuses the reveal to the player who hid it (§18)', () => {
    const state = hiddenTable({
      p1: [card('2', 'clubs')], // the chooser, void in hearts
      p2: [card('5', 'hearts')],
      p3: [card('A', 'hearts')],
      p4: [card('4', 'hearts')],
    });
    const led = scenario(state, { currentPlayerId: 'p2' });
    const withLead = applyOrThrow(led, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('5', 'hearts').id });
    const atChooser = scenario(withLead, { currentPlayerId: 'p1' });

    const refused = refuse(atChooser, { type: 'REVEAL_TRUMP', playerId: 'p1' });
    assert.equal(refused?.code, 'CANNOT_REVEAL_OWN_CARD');
  });

  it('lets a player decline and ask on a later trick (§20, §61–62)', () => {
    const state = hiddenTable({
      p1: [card('5', 'hearts'), card('6', 'hearts')],
      p2: [card('2', 'clubs'), card('3', 'clubs')],
      p3: [card('A', 'hearts'), card('K', 'hearts')],
      p4: [card('4', 'hearts'), card('7', 'hearts')],
    });
    // Trick one: p2 is void and simply discards.
    let done = playTrick(state, [
      ['p1', card('5', 'hearts')],
      ['p2', card('2', 'clubs')],
      ['p3', card('A', 'hearts')],
      ['p4', card('4', 'hearts')],
    ]);
    assert.equal(done.trumpSuit, null, 'declining must leave the card hidden');

    // Trick two: p3 leads, p2 is void again and this time asks.
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p3', cardId: card('K', 'hearts').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p4', cardId: card('7', 'hearts').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('6', 'hearts').id });
    done = applyOrThrow(done, { type: 'REVEAL_TRUMP', playerId: 'p2' });
    assert.equal(done.trumpSuit, 'spades');
  });

  it('gives the hidden card back unrevealed as an ordinary card at the end', () => {
    // The chooser is down to nothing but the card they hid.
    const state = hiddenTable(
      {
        p1: [],
        p2: [card('5', 'hearts')],
        p3: [card('A', 'hearts')],
        p4: [card('4', 'hearts')],
      },
      card('10', 'spades'),
    );
    let done = scenario(state, { currentPlayerId: 'p2' });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p2', cardId: card('5', 'hearts').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p3', cardId: card('A', 'hearts').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p4', cardId: card('4', 'hearts').id });
    done = applyOrThrow(done, { type: 'PLAY_CARD', playerId: 'p1', cardId: card('10', 'spades').id });

    // It reached the table, so the Mindi on it is capturable and spades never
    // became trump.
    assert.equal(done.trumpSuit, null);
    assert.equal(done.completedTricks[0]!.mindis, 1);
    assert.equal(done.completedTricks[0]!.winnerPlayerId, 'p3');
  });
});

describe('choosing how trump is set (§86 step 4)', () => {
  it('is the chooser’s decision alone', () => {
    const game = newMatch(4);
    const chooser = game.chooserId;
    const other = game.players.find((p) => p.id !== chooser)!.id;

    const refused = refuse(game, { type: 'CHOOSE_MODE', playerId: other, mode: 'KATTE' });
    assert.equal(refused?.code, 'NOT_THE_CHOOSER');

    const chosen = applyOrThrow(game, { type: 'CHOOSE_MODE', playerId: chooser, mode: 'KATTE' });
    assert.equal(chosen.mode, 'KATTE');
    assert.equal(chosen.status, 'PLAYING');
    assert.equal(chosen.hiddenCard, null, 'Katte hides nothing');
  });

  it('takes a card out of the chooser’s hand when they hide', () => {
    const game = newMatch(4);
    const chooser = game.chooserId;
    const before = game.players.find((p) => p.id === chooser)!.hand.length;

    const chosen = applyOrThrow(game, { type: 'CHOOSE_MODE', playerId: chooser, mode: 'HIDDEN' });
    const after = chosen.players.find((p) => p.id === chooser)!.hand.length;

    assert.equal(after, before - 1);
    assert.ok(chosen.hiddenCard);
    // Twelve playable and one face down still adds up to a full hand.
    assert.equal(after + 1, before);
  });

  it('shows the hidden card to the chooser and to nobody else', () => {
    const game = newMatch(4);
    const chooser = game.chooserId;
    const chosen = applyOrThrow(game, { type: 'CHOOSE_MODE', playerId: chooser, mode: 'HIDDEN' });
    const hiddenId = chosen.hiddenCard!.id;

    const chooserView = viewMindiFor(chosen, chooser);
    assert.equal(chooserView.yourHiddenCard?.id, hiddenId);

    for (const player of chosen.players.filter((p) => p.id !== chooser)) {
      const view = viewMindiFor(chosen, player.id);
      assert.equal(view.yourHiddenCard, null);
      assert.equal(view.hiddenCardWaiting, true, 'they know a card is down, not which');
      assert.equal(JSON.stringify(view).includes(`"${hiddenId}"`), false, 'leaked the hidden card');
    }
  });
});

describe('edge cases found by probing the built engine', () => {
  it('refuses the reveal to the player on lead (§17)', () => {
    // Nobody has led to the leader, so there is no suit they failed to follow.
    const state = scenario(newMatch(4), {
      status: 'PLAYING',
      mode: 'HIDDEN',
      hiddenCard: card('9', 'spades'),
      hiddenRevealed: false,
      chooserId: 'p1',
      currentPlayerId: 'p2',
      hands: { p2: [card('5', 'hearts')] },
    });
    const refused = refuse(state, { type: 'REVEAL_TRUMP', playerId: 'p2' });
    assert.equal(refused?.code, 'CAN_STILL_FOLLOW_SUIT');
    assert.match(refused?.message ?? '', /leading/);
  });
});
