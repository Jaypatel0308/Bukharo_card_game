import { randomFillSync } from 'node:crypto';

import {
  DEFAULT_MINDI_RULES,
  applyMindiAction,
  createMindiMatch,
  cryptoRng,
  forceSkipTurn,
  setTeamName,
  startNextHand,
  viewMindiFor,
  type MindiAction,
  type MindiRules,
  type MindiState,
  type TeamId,
} from '@bukharo/game-mindi';
import { clampTarget, describeGame, type GameSnapshot } from '@bukharo/shared';

import type { GameModule, GameOutcome, GamePhase } from './module.js';

const rng = cryptoRng((array) => {
  randomFillSync(array);
  return array;
});

function asState(state: unknown): MindiState {
  return state as MindiState;
}

function asRules(settings: unknown): MindiRules {
  return settings as MindiRules;
}

export const mindiModule: GameModule = {
  id: 'mindi',

  settingsFor(target) {
    const clamped = clampTarget(describeGame('mindi'), target);
    return { ...DEFAULT_MINDI_RULES, kotTarget: clamped } satisfies MindiRules;
  },

  createMatch(options, settings) {
    return createMindiMatch({
      roomId: options.roomId,
      seats: options.seats,
      rules: asRules(settings),
      rng,
      teamNames: options.teamNames as Partial<Record<TeamId, string>>,
    });
  },

  startNextRound(state, settings) {
    return startNextHand(asState(state), asRules(settings), rng);
  },

  parseAction(payload, playerId) {
    const action = payload as Record<string, unknown>;
    switch (action?.type) {
      case 'CHOOSE_MODE':
        if (action.mode !== 'HIDDEN' && action.mode !== 'KATTE') return null;
        return { type: 'CHOOSE_MODE', playerId, mode: action.mode } satisfies MindiAction;
      case 'REVEAL_TRUMP':
        return { type: 'REVEAL_TRUMP', playerId } satisfies MindiAction;
      case 'PLAY_CARD':
        if (typeof action.cardId !== 'string' || action.cardId.length > 64) return null;
        return { type: 'PLAY_CARD', playerId, cardId: action.cardId } satisfies MindiAction;
      default:
        return null;
    }
  },

  applyAction(state, action, settings): GameOutcome {
    const result = applyMindiAction(asState(state), action as MindiAction, asRules(settings), rng);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true, state: result.state, events: result.events };
  },

  viewFor(state, playerId): GameSnapshot {
    return { gameId: 'mindi', view: viewMindiFor(asState(state), playerId) };
  },

  phaseOf(state): GamePhase {
    const status = asState(state).status;
    if (status === 'HAND_END') return 'ROUND_END';
    if (status === 'MATCH_END') return 'MATCH_END';
    return 'PLAYING';
  },

  currentPlayerId(state) {
    return asState(state).currentPlayerId;
  },

  skipCurrentPlayer(state, reason) {
    // A trick cannot resolve without a card from everyone, so getting past an
    // absent player means playing one for them. See forceSkipTurn.
    return forceSkipTurn(asState(state), reason, DEFAULT_MINDI_RULES);
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
