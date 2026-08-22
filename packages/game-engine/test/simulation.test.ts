import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyAction, startNextRound } from '../src/engine.js';
import { validateMeld, validateOpeningRun, selectResolution, assignmentsOf } from '../src/meld.js';
import { seededRng, type Rng } from '../src/random.js';
import { viewFor } from '../src/view.js';
import type { Card, GameAction, GameState } from '../src/types.js';
import { newGame, rules } from './helpers.js';

const RULES = rules();

/** Every card in play, wherever it currently lives. */
function allCards(state: GameState): Card[] {
  return [
    ...state.players.flatMap((p) => p.hand),
    ...state.stock,
    ...state.discardPile,
    ...state.bucharoo,
    ...state.melds.flatMap((m) => m.cards.map((c) => c.card)),
    ...(state.wildCard ? [state.wildCard] : []),
  ];
}

function assertNoCardsLostOrCloned(state: GameState, context: string): void {
  const cards = allCards(state);
  assert.equal(cards.length, 108, `${context}: expected 108 cards, saw ${cards.length}`);
  assert.equal(new Set(cards.map((c) => c.id)).size, 108, `${context}: duplicate card ids`);
}

function combinations<T>(items: T[], size: number, limit = 400): T[][] {
  const out: T[][] = [];
  const walk = (start: number, picked: T[]): void => {
    if (out.length >= limit) return;
    if (picked.length === size) {
      out.push([...picked]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      picked.push(items[i]!);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * A bot that only ever submits moves the engine accepts. It plays badly, which
 * is exactly what we want: it wanders into odd corners of the rules.
 */
function botTurn(state: GameState, rng: Rng): GameState {
  const playerId = state.currentPlayerId;
  let current = state;

  // 1. Draw — unless this is the continuation of a turn. Taking the Bucharoo
  // hands the player thirteen cards and keeps the turn with them (§99.10), so
  // a turn does not always begin at the draw.
  if (current.turnPhase === 'AWAITING_DRAW') {
    const wantsPile = current.discardPile.length > 0 && rng.nextInt(4) === 0;
    const drawAction: GameAction = wantsPile
      ? { type: 'TAKE_DISCARD_PILE', playerId }
      : { type: 'DRAW_STOCK', playerId };
    const drawn = applyAction(current, drawAction, RULES);
    if (!drawn.ok) {
      // Stock empty and the pile is the only source, or vice versa.
      const fallback = applyAction(
        current,
        wantsPile ? { type: 'DRAW_STOCK', playerId } : { type: 'TAKE_DISCARD_PILE', playerId },
        RULES,
      );
      if (!fallback.ok) {
        throw new Error(
          `neither draw was legal: stock ${current.stock.length}, pile ${current.discardPile.length}, ` +
            `phase ${current.turnPhase}, emptiedAt ${current.stockEmptiedAtTurn}, turn ${current.turnCounter}`,
        );
      }
      current = fallback.state;
    } else {
      current = drawn.state;
    }
    assertNoCardsLostOrCloned(current, 'after draw');
    if (current.status !== 'PLAYING') return current;
  }

  // 2. Play whatever is legal, a few attempts per turn.
  for (let attempt = 0; attempt < 4; attempt++) {
    const player = current.players.find((p) => p.id === playerId)!;
    const opened = current.teams[player.teamId].isOpened;
    const ctx = { wildRank: current.wildRank, rules: RULES };
    let played = false;

    if (!opened) {
      for (const combo of combinations(player.hand, 4)) {
        const check = validateOpeningRun(combo, ctx);
        if (!check.ok) continue;
        const result = applyAction(
          current,
          { type: 'CREATE_MELD', playerId, cardIds: combo.map((c) => c.id) },
          RULES,
        );
        if (result.ok) {
          current = result.state;
          played = true;
          break;
        }
      }
    } else {
      // Extend an existing team meld first, then try fresh melds.
      const teamMelds = current.melds.filter((m) => m.teamId === player.teamId);
      outer: for (const meld of teamMelds) {
        for (const card of player.hand) {
          const combined = [...meld.cards.map((c) => c.card), card];
          const check = validateMeld(combined, ctx, meld.type);
          if (!check.ok) continue;
          const chosen = selectResolution(check.resolutions, undefined);
          const result = applyAction(
            current,
            {
              type: 'ADD_TO_MELD',
              playerId,
              meldId: meld.id,
              cardIds: [card.id],
              ...(chosen.ok ? {} : { wildAssignments: assignmentsOf(chosen.options[0]!) }),
            },
            RULES,
          );
          if (result.ok) {
            current = result.state;
            played = true;
            break outer;
          }
        }
      }

      if (!played) {
        for (const combo of combinations(player.hand, 3)) {
          const check = validateMeld(combo, ctx);
          if (!check.ok) continue;
          const chosen = selectResolution(check.resolutions, undefined);
          const result = applyAction(
            current,
            {
              type: 'CREATE_MELD',
              playerId,
              cardIds: combo.map((c) => c.id),
              ...(chosen.ok ? {} : { wildAssignments: assignmentsOf(chosen.options[0]!) }),
            },
            RULES,
          );
          if (result.ok) {
            current = result.state;
            played = true;
            break;
          }
        }
      }
    }

    assertNoCardsLostOrCloned(current, 'after meld');
    if (!played || current.status !== 'PLAYING') break;
  }

  if (current.status !== 'PLAYING') return current;

  // 3. Discard.
  const player = current.players.find((p) => p.id === playerId)!;
  if (player.hand.length === 0) {
    throw new Error(`empty hand but the turn did not end: phase ${current.turnPhase}`);
  }

  // Try every card before giving up. A single random pick can be refused for
  // a reason particular to that card, and silently keeping the turn would
  // spin the caller's loop forever while looking like a stalled round.
  const order = [...player.hand].sort(() => rng.nextInt(3) - 1);
  for (const pick of order) {
    const discarded = applyAction(current, { type: 'DISCARD', playerId, cardId: pick.id }, RULES);
    if (discarded.ok) {
      assertNoCardsLostOrCloned(discarded.state, 'after discard');
      return discarded.state;
    }
  }

  throw new Error(
    `no card could be discarded: phase ${current.turnPhase}, hand ${player.hand.length}, ` +
      `stock ${current.stock.length}, pile ${current.discardPile.length}`,
  );
}

describe('four-player simulation (§94)', () => {
  it('plays complete rounds without losing, cloning or leaking cards', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seededRng(seed * 1000 + 7);
      let state = newGame({ targetScore: 100000 }, seed);
      assertNoCardsLostOrCloned(state, `seed ${seed} deal`);

      let turns = 0;
      while (state.status === 'PLAYING' && turns < 300) {
        const before = state.currentPlayerId;
        state = botTurn(state, rng);
        turns++;

        // The redaction boundary must hold at every point in the game. The
        // discard pile and the log are deliberately public (everyone watched
        // those cards land face up), so the check covers the parts of the
        // payload that describe hidden state.
        const view = viewFor(state, before);
        const { discardPile: _pile, log: _log, ...hiddenState } = view;
        const serialized = JSON.stringify(hiddenState);
        for (const opponent of state.players.filter((p) => p.id !== before)) {
          for (const hidden of opponent.hand) {
            assert.equal(serialized.includes(`"${hidden.id}"`), false, `leaked ${hidden.id}`);
          }
        }
        for (const hidden of [...state.stock, ...state.bucharoo]) {
          assert.equal(serialized.includes(`"${hidden.id}"`), false, `leaked ${hidden.id}`);
        }
      }

      // §84 — every round must terminate, even when nobody can go out.
      assert.ok(turns < 300, `seed ${seed} did not terminate`);
      assert.ok(
        state.status === 'ROUND_END' || state.status === 'MATCH_END',
        `seed ${seed} ended in ${state.status}`,
      );
      assertNoCardsLostOrCloned(state, `seed ${seed} end`);

      if (state.status === 'ROUND_END') {
        const next = startNextRound(state, RULES, rng);
        assertNoCardsLostOrCloned(next, `seed ${seed} next round`);
        assert.equal(next.melds.length, 0);
      }
    }
  });

  it('produces round scores that match the sum of their parts', () => {
    let state = newGame({ targetScore: 100000 }, 3);
    const rng = seededRng(99);
    let turns = 0;
    while (state.status === 'PLAYING' && turns < 300) {
      state = botTurn(state, rng);
      turns++;
    }
    const record = state.scoreHistory[0];
    assert.ok(record, 'the round should have produced a score record');
    for (const team of Object.values(record.teams)) {
      assert.equal(
        team.roundTotal,
        team.cardPoints +
          team.cleanBucharoBonus +
          team.dirtyBucharoBonus +
          team.bucharooBonus +
          team.goingOutBonus -
          team.handPenalty,
      );
    }
  });
});


describe('whole matches, not just the first round (§94)', () => {
  /**
   * The round-by-round test stops after one deal. Faults that need a second
   * deal to appear — state carried over, a wild rank that never resets, a
   * match that cannot reach its target — only show up here.
   */
  it('reaches a winner without losing a card or stalling', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = seededRng(seed * 31 + 5);
      let state = newGame({ targetScore: 500 }, seed);
      let rounds = 0;

      while (state.status !== 'MATCH_END' && rounds < 60) {
        let turns = 0;
        while (state.status === 'PLAYING' && turns < 300) {
          state = botTurn(state, rng);
          turns++;
        }
        assert.ok(turns < 300, `seed ${seed} round ${rounds} never ended`);
        assertNoCardsLostOrCloned(state, `seed ${seed} round ${rounds}`);

        // A fresh deal must not inherit the last one.
        if (state.status === 'ROUND_END') {
          state = startNextRound(state, RULES, rng);
          assert.equal(state.melds.length, 0, 'melds carried into the next round');
          assert.equal(state.bucharooTaken, false, 'the Bucharoo carried over');
          assert.equal(state.teams.TEAM_A.isOpened, false);
          assert.equal(state.teams.TEAM_B.isOpened, false);
          assert.notEqual(state.wildRank, null, 'a round dealt with no wild rank');
          assert.equal(state.wildCard?.isJoker ?? false, false, 'a Joker stood as the wild rank');
          assertNoCardsLostOrCloned(state, `seed ${seed} deal ${rounds + 1}`);
        }
        rounds++;
      }

      assert.equal(state.status, 'MATCH_END', `seed ${seed} never finished (${rounds} rounds)`);
      const { TEAM_A, TEAM_B } = state.teams;
      assert.ok(
        TEAM_A.matchScore >= 500 || TEAM_B.matchScore >= 500,
        `seed ${seed} ended with nobody at the target`,
      );
    }
  });
});
