import { randomFillSync } from 'node:crypto';

import {
  DEFAULT_RULES,
  SEAT_ORDER,
  applyAction,
  createMatch,
  cryptoRng,
  forceSkipTurn,
  setTeamName,
  startNextRound,
  viewFor,
  type GameAction,
  type GameState,
  type RuleConfig,
  type Seat,
  type TeamId,
  type WildAssignment,
} from '@bukharo/game-engine';
import { clampTarget, describeGame, type GameSnapshot } from '@bukharo/shared';

import type { CreateOptions, GameModule, GameOutcome, GamePhase } from './module.js';

const RANKS = new Set(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
const SUITS = new Set(['clubs', 'diamonds', 'hearts', 'spades']);

/**
 * A client's chosen reading of its wild cards.
 *
 * Forwarded straight to the rule engine, so a malformed one would surface as
 * an internal error rather than a refusal. Anything that is not a well-formed
 * list is dropped, which simply lets the engine resolve the wild itself.
 */
function asWildAssignments(value: unknown): WildAssignment[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return undefined;

  const assignments: WildAssignment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return undefined;
    const { cardId, representedRank, representedSuit } = entry as Record<string, unknown>;
    if (typeof cardId !== 'string' || cardId.length > 64) return undefined;
    if (typeof representedRank !== 'string' || !RANKS.has(representedRank)) return undefined;
    if (representedSuit !== null && (typeof representedSuit !== 'string' || !SUITS.has(representedSuit))) {
      return undefined;
    }
    assignments.push({
      cardId,
      representedRank: representedRank as WildAssignment['representedRank'],
      representedSuit: (representedSuit ?? null) as WildAssignment['representedSuit'],
    });
  }
  return assignments;
}

const rng = cryptoRng((array) => {
  randomFillSync(array);
  return array;
});

/** Bukharo's engine speaks in compass seats; the room speaks in positions. */
function seatsFor(seats: CreateOptions['seats']): Array<{ id: string; displayName: string; seat: Seat }> {
  return [...seats]
    .sort((a, b) => a.position - b.position)
    .map((seat, index) => ({ id: seat.id, displayName: seat.displayName, seat: SEAT_ORDER[index]! }));
}

function asState(state: unknown): GameState {
  return state as GameState;
}

function asRules(settings: unknown): RuleConfig {
  return settings as RuleConfig;
}

export const bukharoModule: GameModule = {
  id: 'bukharo',

  settingsFor(target) {
    const clamped = clampTarget(describeGame('bukharo'), target);
    return { ...DEFAULT_RULES, targetScore: clamped } satisfies RuleConfig;
  },

  createMatch(options, settings) {
    return createMatch({
      roomId: options.roomId,
      seats: seatsFor(options.seats),
      targetScore: asRules(settings).targetScore,
      rules: asRules(settings),
      rng,
      teamNames: options.teamNames as Partial<Record<TeamId, string>>,
    });
  },

  startNextRound(state, settings) {
    return startNextRound(asState(state), asRules(settings), rng);
  },

  parseAction(payload, playerId) {
    const action = payload as Record<string, unknown>;
    switch (action?.type) {
      case 'DRAW_STOCK':
        return { type: 'DRAW_STOCK', playerId } satisfies GameAction;
      case 'TAKE_DISCARD_PILE':
        return { type: 'TAKE_DISCARD_PILE', playerId } satisfies GameAction;
      case 'CREATE_MELD':
        if (!Array.isArray(action.cardIds)) return null;
        return {
          type: 'CREATE_MELD',
          playerId,
          cardIds: action.cardIds.filter((id) => typeof id === 'string').slice(0, 30),
          ...(action.meldType ? { meldType: action.meldType } : {}),
          ...(() => {
            const wilds = asWildAssignments(action.wildAssignments);
            return wilds ? { wildAssignments: wilds } : {};
          })(),
        } as GameAction;
      case 'ADD_TO_MELD':
        if (!Array.isArray(action.cardIds) || typeof action.meldId !== 'string') return null;
        return {
          type: 'ADD_TO_MELD',
          playerId,
          meldId: action.meldId,
          cardIds: action.cardIds.filter((id) => typeof id === 'string').slice(0, 30),
          ...(() => {
            const wilds = asWildAssignments(action.wildAssignments);
            return wilds ? { wildAssignments: wilds } : {};
          })(),
        } as GameAction;
      case 'DISCARD':
        if (typeof action.cardId !== 'string') return null;
        return { type: 'DISCARD', playerId, cardId: action.cardId } satisfies GameAction;
      default:
        return null;
    }
  },

  applyAction(state, action, settings): GameOutcome {
    const result = applyAction(asState(state), action as GameAction, asRules(settings));
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
        ...(result.options ? { options: result.options } : {}),
      };
    }
    return { ok: true, state: result.state, events: result.events };
  },

  viewFor(state, playerId): GameSnapshot {
    return { gameId: 'bukharo', view: viewFor(asState(state), playerId) };
  },

  phaseOf(state): GamePhase {
    const status = asState(state).status;
    if (status === 'ROUND_END') return 'ROUND_END';
    if (status === 'MATCH_END') return 'MATCH_END';
    return 'PLAYING';
  },

  currentPlayerId(state) {
    return asState(state).currentPlayerId;
  },

  skipCurrentPlayer(state, reason) {
    return forceSkipTurn(asState(state), reason);
  },

  renameTeam(state, teamId, name) {
    return setTeamName(asState(state), teamId as TeamId, name);
  },

  stampLog(state, now) {
    const game = asState(state);
    for (let i = game.log.length - 1; i >= 0; i--) {
      const entry = game.log[i]!;
      if (entry.timestamp > 1e12) break;
      entry.timestamp = now;
    }
  },
};
