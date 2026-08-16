import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyAction, endRound, startNextRound } from '../src/engine.js';
import { seededRng } from '../src/random.js';
import { viewFor } from '../src/view.js';
import { card, ids, joker, newGame, playing, rules, scenario } from './helpers.js';

describe('dealing (§7)', () => {
  it('deals 13 cards to each player and a 13-card Bucharoo', () => {
    const game = newGame();
    for (const player of game.players) assert.equal(player.hand.length, 13);
    assert.equal(game.bucharoo.length, 13);
    assert.equal(game.discardPile.length, 1);
    assert.equal(game.status, 'PLAYING');
  });

  it('accounts for all 108 cards with no duplicates', () => {
    const game = newGame();
    const all = [
      ...game.players.flatMap((p) => p.hand),
      ...game.bucharoo,
      ...game.stock,
      ...game.discardPile,
      ...(game.wildCard ? [game.wildCard] : []),
    ];
    assert.equal(all.length, 108);
    assert.equal(new Set(all.map((c) => c.id)).size, 108);
  });

  it('picks a natural rank as the round wild and never a joker (§85)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const game = newGame({}, seed);
      assert.equal(game.wildCard?.isJoker, false);
      assert.notEqual(game.wildRank, null);
    }
  });

  it('starts play to the dealer’s left and rotates the dealer each round (§66)', () => {
    const game = newGame();
    assert.notEqual(game.currentPlayerId, game.dealerPlayerId);
    const next = startNextRound(game, rules(), seededRng(7));
    assert.notEqual(next.dealerPlayerId, game.dealerPlayerId);
    assert.equal(next.roundNumber, 2);
  });
});

describe('turn structure (§16/§17)', () => {
  it('requires a draw before melding', () => {
    const game = newGame();
    const result = applyAction(
      game,
      { type: 'CREATE_MELD', playerId: game.currentPlayerId, cardIds: [] },
      rules(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'MUST_DRAW_FIRST');
  });

  it('rejects a second draw in the same turn (§59)', () => {
    const game = newGame();
    const first = applyAction(game, { type: 'DRAW_STOCK', playerId: game.currentPlayerId }, rules());
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = applyAction(first.state, { type: 'DRAW_STOCK', playerId: game.currentPlayerId }, rules());
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.code, 'ALREADY_DREW');
    // Exactly one card left the stock, no matter how many requests arrived.
    const drawer = first.state.players.find((p) => p.id === game.currentPlayerId)!;
    assert.equal(drawer.hand.length, 14);
    assert.equal(first.state.stock.length, game.stock.length - 1);
  });

  it('rejects actions from a player who is not on turn', () => {
    const game = newGame();
    const other = game.players.find((p) => p.id !== game.currentPlayerId)!;
    const result = applyAction(game, { type: 'DRAW_STOCK', playerId: other.id }, rules());
    assert.equal(result.ok === false && result.code, 'NOT_YOUR_TURN');
  });

  it('draws exactly one card and reveals it only to the drawer (§18)', () => {
    const game = newGame();
    const before = game.stock.length;
    const result = applyAction(game, { type: 'DRAW_STOCK', playerId: game.currentPlayerId }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.stock.length, before - 1);
    assert.equal(result.state.turnPhase, 'PLAYING_CARDS');

    const priv = result.events.find((e) => e.type === 'CARD_DRAWN');
    assert.equal(priv?.privateToPlayerId, game.currentPlayerId);
    const pub = result.events.find((e) => e.type === 'PLAYER_DREW_CARD');
    assert.equal(pub?.privateToPlayerId, undefined);
    assert.equal('card' in (pub?.payload ?? {}), false);
  });

  it('advances clockwise after a discard', () => {
    const game = newGame();
    const drawn = applyAction(game, { type: 'DRAW_STOCK', playerId: game.currentPlayerId }, rules());
    assert.equal(drawn.ok, true);
    if (!drawn.ok) return;
    const player = drawn.state.players.find((p) => p.id === game.currentPlayerId)!;
    const discarded = applyAction(
      drawn.state,
      { type: 'DISCARD', playerId: player.id, cardId: player.hand[0]!.id },
      rules(),
    );
    assert.equal(discarded.ok, true);
    if (!discarded.ok) return;
    assert.equal(discarded.state.turnPhase, 'AWAITING_DRAW');
    assert.notEqual(discarded.state.currentPlayerId, player.id);
    assert.equal(discarded.state.hasDrawnThisTurn, false);
  });
});

describe('discard pile (§20/§21)', () => {
  it('takes the entire pile with no qualification', () => {
    const game = newGame();
    const pile = [card('2', 'clubs'), card('9', 'diamonds'), card('K', 'spades'), card('4', 'hearts')];
    const state = scenario(game, { discardPile: pile });
    const handBefore = state.players.find((p) => p.id === state.currentPlayerId)!.hand.length;

    const result = applyAction(state, { type: 'TAKE_DISCARD_PILE', playerId: state.currentPlayerId }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const player = result.state.players.find((p) => p.id === state.currentPlayerId)!;
    assert.equal(player.hand.length, handBefore + 4);
    assert.equal(result.state.discardPile.length, 0);
  });

  it('is allowed before the team has opened, but ordinary melds are not (§21)', () => {
    const game = newGame();
    const state = playing(game, 'p1', [
      card('8', 'spades'), card('8', 'hearts'), card('8', 'diamonds'), card('2', 'clubs'),
    ], { wildRank: 'K', opened: { TEAM_A: false } });

    const meld = applyAction(
      state,
      { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids([card('8', 'spades'), card('8', 'hearts'), card('8', 'diamonds')]) },
      rules(),
    );
    assert.equal(meld.ok, false);
    assert.equal(meld.ok === false && meld.code, 'OPENING_REQUIREMENTS');
  });

  it('refuses an empty discard pile', () => {
    const game = newGame();
    const state = scenario(game, { discardPile: [] });
    const result = applyAction(state, { type: 'TAKE_DISCARD_PILE', playerId: state.currentPlayerId }, rules());
    assert.equal(result.ok === false && result.code, 'EMPTY_DISCARD_PILE');
  });
});

describe('team opening (§12/§15)', () => {
  it('opens the whole team and lets the partner play afterwards', () => {
    const game = newGame();
    const opening = [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    let state = playing(game, 'p1', [...opening, card('2', 'clubs')], { wildRank: 'K' });

    const opened = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(opening) }, rules());
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.state.teams.TEAM_A.isOpened, true);
    assert.equal(opened.state.teams.TEAM_B.isOpened, false);
    assert.equal(opened.state.melds[0]!.teamId, 'TEAM_A');
    assert.equal(opened.state.melds[0]!.isOpeningMeld, true);

    // p3 is p1's partner (NORTH/SOUTH) and may now meld ordinary sets.
    const partnerState = playing(opened.state, 'p3', [
      card('9', 'clubs'), card('9', 'hearts'), card('9', 'spades'), card('2', 'diamonds'),
    ]);
    const partnerMeld = applyAction(
      partnerState,
      { type: 'CREATE_MELD', playerId: 'p3', cardIds: ids([card('9', 'clubs'), card('9', 'hearts'), card('9', 'spades')]) },
      rules(),
    );
    assert.equal(partnerMeld.ok, true);
  });

  it('lets a partner extend a teammate’s meld (§15)', () => {
    const game = newGame();
    const opening = [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const state = playing(game, 'p1', [...opening, card('2', 'clubs')], { wildRank: 'K' });
    const opened = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(opening) }, rules());
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const meldId = opened.state.melds[0]!.id;

    const partnerState = playing(opened.state, 'p3', [card('8', 'hearts'), card('2', 'diamonds')]);
    const extended = applyAction(
      partnerState,
      { type: 'ADD_TO_MELD', playerId: 'p3', meldId, cardIds: [card('8', 'hearts').id] },
      rules(),
    );
    assert.equal(extended.ok, true);
    if (!extended.ok) return;
    assert.equal(extended.state.melds[0]!.cards.length, 5);
  });

  it('refuses to add to the opposing team’s meld', () => {
    const game = newGame();
    const opening = [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const state = playing(game, 'p1', [...opening, card('2', 'clubs')], { wildRank: 'K' });
    const opened = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(opening) }, rules());
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const opponentState = playing(opened.state, 'p2', [card('8', 'hearts'), card('2', 'diamonds')], {
      opened: { TEAM_B: true },
    });
    const result = applyAction(
      opponentState,
      { type: 'ADD_TO_MELD', playerId: 'p2', meldId: opened.state.melds[0]!.id, cardIds: [card('8', 'hearts').id] },
      rules(),
    );
    assert.equal(result.ok === false && result.code, 'MELD_WRONG_TEAM');
  });

  it('rejects cards the player does not hold (§82)', () => {
    const game = newGame();
    const state = playing(game, 'p1', [card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs')], {
      wildRank: 'K',
    });
    const result = applyAction(
      state,
      { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids([card('A', 'spades'), card('2', 'clubs'), card('3', 'clubs')]) },
      rules(),
    );
    assert.equal(result.ok === false && result.code, 'CARD_NOT_IN_HAND');
  });
});

describe('Bucharos (§22/§23)', () => {
  const openTeamA = { opened: { TEAM_A: true } } as const;

  it('marks a 7-card clean meld and locks the clean bonus', () => {
    const game = newGame();
    const run = [
      card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
      card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
    ];
    const state = playing(game, 'p1', [...run, card('2', 'clubs')], { wildRank: 'K', ...openTeamA });
    const result = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meld = result.state.melds[0]!;
    assert.equal(meld.isBucharo, true);
    assert.equal(meld.bucharoBonusAwarded, 'CLEAN');
  });

  it('marks a 7-card meld containing a wild as dirty', () => {
    const game = newGame();
    const run = [
      card('4', 'spades'), card('5', 'spades'), joker(), card('7', 'spades'),
      card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
    ];
    const state = playing(game, 'p1', [...run, card('2', 'clubs')], { wildRank: 'K', ...openTeamA });
    const result = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.melds[0]!.bucharoBonusAwarded, 'DIRTY');
  });

  it('promotes a 6-card meld to a Bucharo when it reaches 7', () => {
    const game = newGame();
    const six = [
      card('4', 'spades'), card('5', 'spades'), card('6', 'spades'),
      card('7', 'spades'), card('8', 'spades'), card('9', 'spades'),
    ];
    const state = playing(game, 'p1', [...six, card('10', 'spades'), card('2', 'clubs')], {
      wildRank: 'K',
      ...openTeamA,
    });
    const first = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(six) }, rules());
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.state.melds[0]!.isBucharo, false);

    const grown = applyAction(
      first.state,
      { type: 'ADD_TO_MELD', playerId: 'p1', meldId: first.state.melds[0]!.id, cardIds: [card('10', 'spades').id] },
      rules(),
    );
    assert.equal(grown.ok, true);
    if (!grown.ok) return;
    assert.equal(grown.state.melds[0]!.isBucharo, true);
    assert.equal(grown.state.melds[0]!.bucharoBonusAwarded, 'CLEAN');
  });

  it('keeps the clean bonus when a wild joins later (§83, lock rule on)', () => {
    const game = newGame();
    const seven = [
      card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
      card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
    ];
    const state = playing(game, 'p1', [...seven, joker(), card('2', 'clubs')], {
      wildRank: 'K',
      ...openTeamA,
    });
    const made = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(seven) }, rules());
    assert.equal(made.ok, true);
    if (!made.ok) return;

    // The joker could extend either end, so the player must say which.
    const ambiguous = applyAction(
      made.state,
      { type: 'ADD_TO_MELD', playerId: 'p1', meldId: made.state.melds[0]!.id, cardIds: [joker().id] },
      rules(),
    );
    assert.equal(ambiguous.ok === false && ambiguous.code, 'AMBIGUOUS_WILD');
    assert.equal(ambiguous.ok === false && ambiguous.options?.length, 2);

    const dirtied = applyAction(
      made.state,
      {
        type: 'ADD_TO_MELD',
        playerId: 'p1',
        meldId: made.state.melds[0]!.id,
        cardIds: [joker().id],
        wildAssignments: [{ cardId: joker().id, representedRank: 'J', representedSuit: 'spades' }],
      },
      rules(),
    );
    assert.equal(dirtied.ok, true);
    if (!dirtied.ok) return;
    assert.equal(dirtied.state.melds[0]!.isClean, false);
    assert.equal(dirtied.state.melds[0]!.bucharoBonusAwarded, 'CLEAN');
  });

  it('downgrades the bonus when the lock rule is switched off', () => {
    const houseRules = rules({ lockBucharoBonusOnCompletion: false });
    const game = newGame({ lockBucharoBonusOnCompletion: false });
    const seven = [
      card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
      card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
    ];
    const state = playing(game, 'p1', [...seven, joker(), card('2', 'clubs')], {
      wildRank: 'K',
      opened: { TEAM_A: true },
    });
    const made = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(seven) }, houseRules);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const dirtied = applyAction(
      made.state,
      {
        type: 'ADD_TO_MELD',
        playerId: 'p1',
        meldId: made.state.melds[0]!.id,
        cardIds: [joker().id],
        wildAssignments: [{ cardId: joker().id, representedRank: 'J', representedSuit: 'spades' }],
      },
      houseRules,
    );
    assert.equal(dirtied.ok, true);
    if (!dirtied.ok) return;
    assert.equal(dirtied.state.melds[0]!.bucharoBonusAwarded, 'DIRTY');
  });
});

describe('Bucharoo (§25)', () => {
  it('hands over the 13-card pile when the original hand empties', () => {
    const game = newGame();
    const run = [card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades')];
    const state = playing(game, 'p1', [...run, card('2', 'clubs')], { wildRank: 'K' });

    const opened = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, rules());
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const discarded = applyAction(
      opened.state,
      { type: 'DISCARD', playerId: 'p1', cardId: card('2', 'clubs').id },
      rules(),
    );
    assert.equal(discarded.ok, true);
    if (!discarded.ok) return;

    const player = discarded.state.players.find((p) => p.id === 'p1')!;
    assert.equal(player.handType, 'BUCHAROO');
    assert.equal(player.hand.length, 13);
    assert.equal(discarded.state.bucharoo.length, 0);
    assert.equal(discarded.state.teams.TEAM_A.tookBucharoo, true);
    assert.equal(discarded.state.status, 'PLAYING');
    // The round did not end: the player picked the Bucharoo up instead, and
    // keeps the turn to play it.
    assert.equal(discarded.state.currentPlayerId, 'p1');
  });

  it('keeps the turn with the player who collected it', () => {
    const game = newGame();
    const run = [card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades')];
    const state = playing(game, 'p1', [...run, card('2', 'clubs')], { wildRank: 'K' });

    const opened = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, rules());
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const discarded = applyAction(
      opened.state,
      { type: 'DISCARD', playerId: 'p1', cardId: card('2', 'clubs').id },
      rules(),
    );
    assert.equal(discarded.ok, true);
    if (!discarded.ok) return;

    // The Bucharoo was collected, so play does not pass on: the same player
    // continues with the new hand and will end the turn with another discard.
    assert.equal(discarded.state.currentPlayerId, 'p1');
    assert.equal(discarded.state.turnPhase, 'PLAYING_CARDS');
    assert.equal(discarded.state.hasDrawnThisTurn, true);
    assert.equal(discarded.state.players.find((p) => p.id === 'p1')!.hand.length, 13);

    // And that second discard does pass the turn on.
    const hand = discarded.state.players.find((p) => p.id === 'p1')!.hand;
    const second = applyAction(
      discarded.state,
      { type: 'DISCARD', playerId: 'p1', cardId: hand[0]!.id },
      rules(),
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.notEqual(second.state.currentPlayerId, 'p1');
  });

  it('passes the turn on instead when the house rule says so', () => {
    const houseRules = rules({ bucharooPickupContinuesTurn: false });
    const game = newGame();
    const run = [card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades')];
    const state = playing(game, 'p1', [...run, card('2', 'clubs')], { wildRank: 'K' });
    const opened = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, houseRules);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const discarded = applyAction(
      opened.state,
      { type: 'DISCARD', playerId: 'p1', cardId: card('2', 'clubs').id },
      houseRules,
    );
    assert.equal(discarded.ok, true);
    if (!discarded.ok) return;
    assert.notEqual(discarded.state.currentPlayerId, 'p1');
  });

  it('picks the Bucharoo up mid-turn when melding empties the hand', () => {
    const game = newGame();
    const run = [card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades')];
    const state = playing(game, 'p1', run, { wildRank: 'K' });
    const result = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const player = result.state.players.find((p) => p.id === 'p1')!;
    assert.equal(player.hand.length, 13);
    assert.equal(player.handType, 'BUCHAROO');
    assert.equal(result.state.turnPhase, 'PLAYING_CARDS');
    const priv = result.events.find((e) => e.type === 'BUCHAROO_HAND');
    assert.equal(priv?.privateToPlayerId, 'p1');
  });

  it('only lets one player take it', () => {
    const game = newGame();
    const state = scenario(game, { bucharoo: [], });
    const marked = { ...state, bucharooTaken: true };
    const run = [card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades')];
    const playState = playing(marked, 'p1', [...run, card('2', 'clubs')], { wildRank: 'K' });
    const opened = applyAction(playState, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, rules());
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const player = opened.state.players.find((p) => p.id === 'p1')!;
    assert.equal(player.hand.length, 1);
    assert.equal(player.handType, 'ORIGINAL');
  });
});

describe('going out (§26/§27)', () => {
  const bucharooGone = { bucharoo: [] };

  it('ends the round when the last card is discarded', () => {
    const game = newGame();
    const base = { ...scenario(game, bucharooGone), bucharooTaken: true, bucharooTakenByTeamId: 'TEAM_A' as const };
    const state = playing(base, 'p1', [card('2', 'clubs')], { wildRank: 'K', opened: { TEAM_A: true } });

    const result = applyAction(state, { type: 'DISCARD', playerId: 'p1', cardId: card('2', 'clubs').id }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.teams.TEAM_A.wentOut, true);
    assert.ok(result.state.status === 'ROUND_END' || result.state.status === 'MATCH_END');
    assert.equal(result.state.scoreHistory.length, 1);
    assert.equal(result.state.scoreHistory[0]!.endedBy, 'WENT_OUT');
  });

  it('refuses to meld away the final card', () => {
    const game = newGame();
    const base = { ...scenario(game, bucharooGone), bucharooTaken: true };
    const run = [card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades')];
    const state = playing(base, 'p1', run, { wildRank: 'K', opened: { TEAM_A: true } });

    const result = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(run) }, rules());
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'MUST_KEEP_DISCARD');
    assert.match(result.ok === false ? result.message : '', /one card to discard/);
  });

  it('blocks going out while the Bucharoo is still on the table', () => {
    const game = newGame();
    const state = playing(game, 'p1', [card('2', 'clubs')], { wildRank: 'K', opened: { TEAM_A: true } });
    // p1 is still on their original hand, so the discard collects the Bucharoo
    // rather than ending the round.
    const result = applyAction(state, { type: 'DISCARD', playerId: 'p1', cardId: card('2', 'clubs').id }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.status, 'PLAYING');
    assert.equal(result.state.teams.TEAM_A.wentOut, false);
  });
});

describe('stock exhaustion (§84)', () => {
  it('directs the player to the discard pile when the stock is empty', () => {
    const game = newGame();
    const state = scenario(game, { stock: [], discardPile: [card('2', 'clubs')] });
    const result = applyAction(state, { type: 'DRAW_STOCK', playerId: state.currentPlayerId }, rules());
    assert.equal(result.ok === false && result.code, 'EMPTY_STOCK');
  });

  it('ends the round when no draw source remains', () => {
    const game = newGame();
    const state = scenario(game, { stock: [], discardPile: [] });
    const result = applyAction(state, { type: 'DRAW_STOCK', playerId: state.currentPlayerId }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.scoreHistory[0]!.endedBy, 'NO_DRAW_SOURCE');
  });

  it('ends the round immediately under the alternative house rule', () => {
    const houseRules = rules({ stockExhaustionRule: 'END_ROUND_IMMEDIATELY' });
    const game = newGame();
    const state = scenario(game, { stock: [], discardPile: [card('2', 'clubs')] });
    const result = applyAction(state, { type: 'DRAW_STOCK', playerId: state.currentPlayerId }, houseRules);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.state.status === 'ROUND_END' || result.state.status === 'MATCH_END');
  });
});

describe('privacy (§57)', () => {
  it('never includes another player’s hand in their view', () => {
    const game = newGame();
    const view = viewFor(game, 'p1');
    const serialized = JSON.stringify(view);

    assert.equal(view.you?.hand.length, 13);
    for (const opponent of view.players) {
      assert.equal('hand' in opponent, false);
      assert.equal(opponent.handCount, 13);
    }
    // No opponent card, stock card or Bucharoo card may appear anywhere.
    const hidden = [
      ...game.players.filter((p) => p.id !== 'p1').flatMap((p) => p.hand),
      ...game.stock,
      ...game.bucharoo,
    ];
    for (const hiddenCard of hidden) {
      assert.equal(serialized.includes(`"${hiddenCard.id}"`), false, `leaked ${hiddenCard.id}`);
    }
    assert.equal(view.stockCount, game.stock.length);
    assert.equal(view.bucharooCount, 13);
  });

  it('gives a spectator no hand at all', () => {
    const game = newGame();
    const view = viewFor(game, null);
    assert.equal(view.you, null);
  });

  it('keeps privately drawn cards out of the log (§56)', () => {
    const game = newGame();
    const result = applyAction(game, { type: 'DRAW_STOCK', playerId: game.currentPlayerId }, rules());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const entry = result.state.log.at(-1)!;
    assert.match(entry.message, /drew from the stock/);
    assert.equal(entry.meta, undefined);
  });
});

describe('round and match flow (§28/§31/§67)', () => {
  it('resets round state but keeps cumulative scores', () => {
    const game = newGame();
    const opening = [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const state = playing(game, 'p1', [...opening, card('2', 'clubs')], { wildRank: 'K' });
    const opened = applyAction(state, { type: 'CREATE_MELD', playerId: 'p1', cardIds: ids(opening) }, rules());
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const ended = endRound(opened.state, rules(), 'WENT_OUT', 'p1');
    const next = startNextRound(ended, rules(), seededRng(11));

    assert.equal(next.teams.TEAM_A.isOpened, false);
    assert.equal(next.teams.TEAM_B.isOpened, false);
    assert.equal(next.melds.length, 0);
    assert.equal(next.bucharoo.length, 13);
    assert.equal(next.bucharooTaken, false);
    assert.equal(next.teams.TEAM_A.matchScore, ended.teams.TEAM_A.matchScore);
    assert.equal(next.scoreHistory.length, 1);
  });

  it('declares a winner once the target is passed', () => {
    const game = newGame({ targetScore: 100 });
    const boosted = {
      ...game,
      teams: {
        TEAM_A: { ...game.teams.TEAM_A, matchScore: 90, wentOut: true },
        TEAM_B: { ...game.teams.TEAM_B },
      },
      players: game.players.map((p) => ({ ...p, hand: [] })),
    };
    const ended = endRound(boosted, rules({ targetScore: 100 }), 'WENT_OUT', 'p1');
    assert.equal(ended.status, 'MATCH_END');
    assert.equal(ended.winningTeamId, 'TEAM_A');
  });
});

describe('post-exhaustion lap limit (§84)', () => {
  it('ends the round after the configured laps once the stock is gone', () => {
    const houseRules = rules({ lapsAfterStockExhausted: 1 });
    const game = newGame();
    // Stock already empty, and the pile always has the previous discard, so
    // without the lap limit play would circulate forever.
    let state = scenario(game, { stock: [], discardPile: [card('2', 'clubs')] });

    let turns = 0;
    while (state.status === 'PLAYING' && turns < 40) {
      const playerId = state.currentPlayerId;
      const took = applyAction(state, { type: 'TAKE_DISCARD_PILE', playerId }, houseRules);
      if (!took.ok) break;
      state = took.state;
      if (state.status !== 'PLAYING') break;
      const hand = state.players.find((p) => p.id === playerId)!.hand;
      const discarded = applyAction(state, { type: 'DISCARD', playerId, cardId: hand[0]!.id }, houseRules);
      if (!discarded.ok) break;
      state = discarded.state;
      turns++;
    }

    assert.notEqual(state.status, 'PLAYING');
    assert.equal(state.scoreHistory.at(-1)?.endedBy, 'NO_DRAW_SOURCE');
    assert.ok(turns <= 5, `expected the round to close after one lap, took ${turns}`);
  });
});
