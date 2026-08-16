import { sumPoints } from './cards.js';
import type { RuleConfig } from './rules.js';
import type {
  GameState,
  Meld,
  RoundScoreRecord,
  TeamId,
  TeamRoundScore,
} from './types.js';

export const TEAM_IDS: TeamId[] = ['TEAM_A', 'TEAM_B'];

/** Which bonus a meld is worth right now, honouring the lock rule (§83). */
export function bucharoBonusFor(meld: Meld, rules: RuleConfig): 'NONE' | 'CLEAN' | 'DIRTY' {
  if (!meld.isBucharo) return 'NONE';
  if (rules.lockBucharoBonusOnCompletion && meld.bucharoBonusAwarded !== 'NONE') {
    return meld.bucharoBonusAwarded;
  }
  return meld.isClean ? 'CLEAN' : 'DIRTY';
}

export function calculateTeamRoundScore(
  state: GameState,
  teamId: TeamId,
  rules: RuleConfig,
): Omit<TeamRoundScore, 'matchTotalAfter'> {
  const team = state.teams[teamId];
  const melds = state.melds.filter((m) => m.teamId === teamId);

  const cardPoints = melds.reduce(
    (total, meld) => total + sumPoints(meld.cards.map((c) => c.card)),
    0,
  );

  let cleanBucharos = 0;
  let dirtyBucharos = 0;
  for (const meld of melds) {
    const bonus = bucharoBonusFor(meld, rules);
    if (bonus === 'CLEAN') cleanBucharos++;
    else if (bonus === 'DIRTY') dirtyBucharos++;
  }

  const handCards = state.players
    .filter((p) => p.teamId === teamId)
    .flatMap((p) => p.hand);

  const cleanBucharoBonus = cleanBucharos * rules.cleanBucharoBonus;
  const dirtyBucharoBonus = dirtyBucharos * rules.dirtyBucharoBonus;
  const bucharooBonus = team.tookBucharoo ? rules.bucharooBonus : 0;
  const goingOutBonus = team.wentOut ? rules.goingOutBonus : 0;
  const handPenalty = sumPoints(handCards);

  const roundTotal =
    cardPoints + cleanBucharoBonus + dirtyBucharoBonus + bucharooBonus + goingOutBonus - handPenalty;

  return {
    teamId,
    cardPoints,
    cleanBucharoBonus,
    dirtyBucharoBonus,
    bucharooBonus,
    goingOutBonus,
    handPenalty,
    roundTotal,
    breakdown: {
      cleanBucharos,
      dirtyBucharos,
      cardsLeftInHands: handCards.length,
    },
  };
}

export function buildRoundScoreRecord(
  state: GameState,
  rules: RuleConfig,
  endedBy: RoundScoreRecord['endedBy'],
  endedByPlayerId: string | null,
): RoundScoreRecord {
  const teams = {} as Record<TeamId, TeamRoundScore>;
  for (const teamId of TEAM_IDS) {
    const score = calculateTeamRoundScore(state, teamId, rules);
    teams[teamId] = {
      ...score,
      matchTotalAfter: state.teams[teamId].matchScore + score.roundTotal,
    };
  }
  return {
    roundNumber: state.roundNumber,
    wildRank: state.wildRank!,
    teams,
    endedBy,
    endedByPlayerId,
  };
}

/**
 * §31 — a team wins by reaching the target after a completed round. If both
 * teams pass it in the same round, the higher cumulative score wins.
 */
export function determineWinner(
  matchScores: Record<TeamId, number>,
  targetScore: number,
): TeamId | null {
  const reached = TEAM_IDS.filter((id) => matchScores[id] >= targetScore);
  if (reached.length === 0) return null;
  if (reached.length === 1) return reached[0]!;
  const [a, b] = reached as [TeamId, TeamId];
  if (matchScores[a] === matchScores[b]) return null; // dead tie → play another round
  return matchScores[a] > matchScores[b] ? a : b;
}
