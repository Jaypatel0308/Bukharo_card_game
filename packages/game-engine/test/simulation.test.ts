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

  // 1. Draw.
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
    if (!fallback.ok) return current;
    current = fallback.state;
  } else {
    current = drawn.state;
  }
  assertNoCardsLostOrCloned(current, 'after draw');
  if (current.status !== 'PLAYING') return current;

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
  if (player.hand.length === 0) return current;
  const pick = player.hand[rng.nextInt(player.hand.length)]!;
  const discarded = applyAction(current, { type: 'DISCARD', playerId, cardId: pick.id }, RULES);
  if (discarded.ok) current = discarded.state;
  assertNoCardsLostOrCloned(current, 'after discard');
  return current;
}

describe('four-player simulation (§94)', () => {
  it('plays complete rounds without losing, cloning or leaking cards', () => {
    for (let seed = 1; seed <= 8; seed++) {
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
