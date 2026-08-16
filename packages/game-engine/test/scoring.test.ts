import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cardPointValue, createDeck, sumPoints } from '../src/cards.js';
import { calculateTeamRoundScore, determineWinner } from '../src/scoring.js';
import type { GameState, Meld, MeldCard } from '../src/types.js';
import { card, joker, newGame, rules } from './helpers.js';

function meldOf(cards: ReturnType<typeof card>[], overrides: Partial<Meld> = {}): Meld {
  const meldCards: MeldCard[] = cards.map((c) => ({
    card: c,
    role: 'NATURAL',
    representedRank: c.rank === 'JOKER' ? 'A' : (c.rank as never),
    representedSuit: c.suit,
  }));
  return {
    id: `meld_${Math.random()}`,
    teamId: 'TEAM_A',
    type: 'RUN',
    cards: meldCards,
    isClean: true,
    isBucharo: cards.length >= 7,
    bucharoBonusAwarded: cards.length >= 7 ? 'CLEAN' : 'NONE',
    createdByPlayerId: 'p1',
    isOpeningMeld: false,
    ...overrides,
  };
}

describe('card values (§6)', () => {
  it('scores 2-7 as 5, 8-K as 10, aces 15 and jokers 30', () => {
    assert.equal(cardPointValue('2'), 5);
    assert.equal(cardPointValue('7'), 5);
    assert.equal(cardPointValue('8'), 10);
    assert.equal(cardPointValue('K'), 10);
    assert.equal(cardPointValue('A'), 15);
    assert.equal(cardPointValue('JOKER'), 30);
  });

  it('keeps the wild rank at its ordinary value (§10)', () => {
    // 2s score 5 whether or not they are the round wild.
    assert.equal(card('2', 'clubs').basePointValue, 5);
    assert.equal(card('Q', 'clubs').basePointValue, 10);
    assert.equal(joker().basePointValue, 30);
  });

  it('totals 108 cards worth a fixed sum', () => {
    const deck = createDeck();
    assert.equal(deck.length, 108);
    assert.equal(new Set(deck.map((c) => c.id)).size, 108);
    // 2 decks × (6×5 + 6×10 + 15) per suit × 4 suits + 4 jokers × 30
    assert.equal(sumPoints(deck), 2 * 4 * (6 * 5 + 6 * 10 + 15) + 4 * 30);
  });
});

describe('round scoring (§28/§30)', () => {
  it('reproduces the worked example from the spec', () => {
    const game = newGame();
    // Build a team position worth 420 card points across melds.
    const cleanBucharo = meldOf([
      card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
      card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
    ]);
    const dirtyBucharo = meldOf(
      [
        card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
        card('8', 'hearts'), card('9', 'hearts'), joker(),
      ],
      { isClean: false, bucharoBonusAwarded: 'DIRTY' },
    );

    const state: GameState = {
      ...game,
      melds: [cleanBucharo, dirtyBucharo],
      players: game.players.map((p) => ({
        ...p,
        hand: p.id === 'p3' ? [card('K', 'clubs'), card('K', 'diamonds'), card('A', 'clubs')] : [],
      })),
      teams: {
        TEAM_A: { ...game.teams.TEAM_A, tookBucharoo: true, wentOut: true },
        TEAM_B: { ...game.teams.TEAM_B },
      },
    };

    const score = calculateTeamRoundScore(state, 'TEAM_A', rules());
    const expectedCardPoints = sumPoints([...cleanBucharo.cards, ...dirtyBucharo.cards].map((c) => c.card));

    assert.equal(score.cardPoints, expectedCardPoints);
    assert.equal(score.cleanBucharoBonus, 200);
    assert.equal(score.dirtyBucharoBonus, 100);
    assert.equal(score.bucharooBonus, 100);
    assert.equal(score.goingOutBonus, 100);
    assert.equal(score.handPenalty, 35); // K + K + A
    assert.equal(
      score.roundTotal,
      expectedCardPoints + 200 + 100 + 100 + 100 - 35,
    );
  });

  it('subtracts cards still held by both partners', () => {
    const game = newGame();
    const state: GameState = {
      ...game,
      melds: [],
      players: game.players.map((p) => ({
        ...p,
        hand: p.teamId === 'TEAM_A' ? [card('A', 'spades')] : [],
      })),
    };
    const score = calculateTeamRoundScore(state, 'TEAM_A', rules());
    assert.equal(score.handPenalty, 30); // two partners × one ace
    assert.equal(score.roundTotal, -30);
  });

  it('counts each Bucharo separately', () => {
    const game = newGame();
    const state: GameState = {
      ...game,
      melds: [
        meldOf([
          card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
          card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
        ]),
        meldOf([
          card('4', 'clubs'), card('5', 'clubs'), card('6', 'clubs'), card('7', 'clubs'),
          card('8', 'clubs'), card('9', 'clubs'), card('10', 'clubs'),
        ]),
      ],
      players: game.players.map((p) => ({ ...p, hand: [] })),
    };
    const score = calculateTeamRoundScore(state, 'TEAM_A', rules());
    assert.equal(score.cleanBucharoBonus, 400);
    assert.equal(score.breakdown.cleanBucharos, 2);
  });
});

describe('match winner (§31)', () => {
  it('needs the target to be reached', () => {
    assert.equal(determineWinner({ TEAM_A: 1990, TEAM_B: 1500 }, 2000), null);
    assert.equal(determineWinner({ TEAM_A: 2000, TEAM_B: 1500 }, 2000), 'TEAM_A');
  });

  it('gives it to the higher score when both pass in the same round', () => {
    assert.equal(determineWinner({ TEAM_A: 2100, TEAM_B: 2400 }, 2000), 'TEAM_B');
  });

  it('plays on when both tie exactly', () => {
    assert.equal(determineWinner({ TEAM_A: 2100, TEAM_B: 2100 }, 2000), null);
  });
});
