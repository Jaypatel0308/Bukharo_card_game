import {
  applyJudgementAction,
  createJudgementMatch,
  legalBidsFor,
  legalCardIdsFor,
  startNextRound,
  type JudgementAction,
} from '../src/engine.js';
import { seededRng } from '../src/random.js';
import { withJudgementRules, type JudgementRules } from '../src/rules.js';
import type { JudgementState } from '../src/types.js';

const NAMES = ['Rahul', 'Maya', 'Priya', 'Sam', 'Nina', 'Omar', 'Zara', 'Kabir', 'Ravi', 'Isha'];

export function seatsFor(count: number) {
  return Array.from({ length: count }, (_, position) => ({
    id: `p${position + 1}`,
    displayName: NAMES[position]!,
    position,
  }));
}

export function newMatch(
  playerCount = 4,
  seed = 42,
  overrides: Partial<JudgementRules> = {},
): JudgementState {
  return createJudgementMatch({
    roomId: 'room_test',
    seats: seatsFor(playerCount),
    rules: withJudgementRules(overrides),
    rng: seededRng(seed),
  });
}

export function applyOrThrow(state: JudgementState, action: JudgementAction): JudgementState {
  const result = applyJudgementAction(state, action);
  if (!result.ok) throw new Error(`${action.type} refused: ${result.code} — ${result.message}`);
  return result.state;
}

export function refuse(state: JudgementState, action: JudgementAction) {
  const result = applyJudgementAction(state, action);
  if (result.ok) throw new Error(`${action.type} should have been refused`);
  return result;
}

/** Everyone bids, in order, taking the first legal number they are offered. */
export function bidAll(state: JudgementState, bids?: number[]): JudgementState {
  let current = state;
  let i = 0;
  while (current.status === 'BIDDING') {
    const playerId = current.currentPlayerId;
    const wanted = bids?.[i];
    const legal = legalBidsFor(current, playerId);
    const bid = wanted !== undefined && legal.includes(wanted) ? wanted : legal[0]!;
    current = applyOrThrow(current, { type: 'PLACE_BID', playerId, bid });
    i++;
  }
  return current;
}

export type { JudgementAction };

/** Plays a round to its end, always taking the first legal card. */
export function playOutRound(state: JudgementState): JudgementState {
  let current = state;
  let guard = 0;
  while (current.status === 'PLAYING' && guard++ < 400) {
    const playerId = current.currentPlayerId;
    const legal = legalCardIdsFor(current, playerId);
    current = applyOrThrow(current, { type: 'PLAY_CARD', playerId, cardId: legal[0]! });
  }
  return current;
}

/** Deals the next round with a fresh, deterministic shuffle. */
export function nextRound(state: JudgementState, seed = state.roundNumber + 1): JudgementState {
  return startNextRound(state, seededRng(seed));
}
