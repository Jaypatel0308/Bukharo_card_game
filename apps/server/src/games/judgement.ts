import { randomFillSync } from 'node:crypto';

import {
  applyJudgementAction,
  createJudgementMatch,
  cryptoRng,
  forceSkipTurn,
  startNextRound,
  viewJudgementFor,
  withJudgementRules,
  type JudgementAction,
  type JudgementRules,
  type JudgementState,
} from '@bukharo/game-judgement';
import { clampTarget, describeGame, type GameSnapshot } from '@bukharo/shared';

import { stampRecentLog, type GameModule, type GameOutcome, type GamePhase } from './module.js';

const rng = cryptoRng((array) => {
  randomFillSync(array);
  return array;
});

function asState(state: unknown): JudgementState {
  return state as JudgementState;
}

function asRules(settings: unknown): JudgementRules {
  return settings as JudgementRules;
}

export const judgementModule: GameModule = {
  id: 'judgement',

  settingsFor(target) {
    // The one thing the players agree beforehand is how long to play (§6).
    return withJudgementRules({ totalRounds: clampTarget(describeGame('judgement'), target) });
  },

  createMatch(options, settings) {
    return createJudgementMatch({
      roomId: options.roomId,
      seats: options.seats,
      rules: asRules(settings),
      rng,
    });
  },

  startNextRound(state) {
    return startNextRound(asState(state), rng);
  },

  parseAction(payload, playerId) {
    const action = payload as Record<string, unknown>;
    switch (action?.type) {
      case 'PLACE_BID': {
        const bid = action.bid;
        // Bounded here as well as in the engine: this is the edge of the
        // server, and an absurd number should never reach the rules at all.
        if (typeof bid !== 'number' || !Number.isInteger(bid) || bid < 0 || bid > 26) return null;
        return { type: 'PLACE_BID', playerId, bid } satisfies JudgementAction;
      }
      case 'PLAY_CARD':
        if (typeof action.cardId !== 'string' || action.cardId.length > 64) return null;
        return { type: 'PLAY_CARD', playerId, cardId: action.cardId } satisfies JudgementAction;
      default:
        return null;
    }
  },

  applyAction(state, action): GameOutcome {
    const result = applyJudgementAction(asState(state), action as JudgementAction);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true, state: result.state, events: result.events };
  },

  viewFor(state, playerId): GameSnapshot {
    return { gameId: 'judgement', view: viewJudgementFor(asState(state), playerId) };
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
    // Both a bid and a trick need something from everyone, so getting past an
    // absent player means acting for them: the lowest legal judgement, or the
    // lowest card they are allowed to play.
    return forceSkipTurn(asState(state), reason);
  },

  renameTeam(state) {
    // Judgement is scored per player. The room refuses the request before it
    // reaches here, so this only has to leave the game untouched.
    return state;
  },

  stampLog(state, now) {
    stampRecentLog(asState(state).log, now);
  },
};
