import type {
  Card,
  GameState,
  HandType,
  LogEntry,
  Meld,
  NaturalRank,
  RoundScoreRecord,
  Seat,
  TeamId,
  TurnPhase,
} from './types.js';

/**
 * §57/§88 — the redaction boundary.
 *
 * `viewFor` is the ONLY function permitted to produce state for a client. It
 * never copies another player's hand, the stock order, or the Bucharoo cards
 * into the payload, so hidden cards cannot leak through network inspection.
 */

export interface OpponentView {
  id: string;
  displayName: string;
  seat: Seat;
  teamId: TeamId;
  handCount: number;
  handType: HandType;
}

export interface SelfView extends OpponentView {
  hand: Card[];
}

export interface TeamView {
  id: TeamId;
  name: string;
  playerIds: string[];
  isOpened: boolean;
  matchScore: number;
  tookBucharoo: boolean;
  wentOut: boolean;
}

export interface GameView {
  roomId: string;
  status: GameState['status'];
  roundNumber: number;
  targetScore: number;

  you: SelfView | null;
  players: OpponentView[];
  teams: Record<TeamId, TeamView>;

  dealerPlayerId: string;
  currentPlayerId: string;
  turnPhase: TurnPhase;
  hasDrawnThisTurn: boolean;

  stockCount: number;
  /** Face up — every player may inspect it (§19). */
  discardPile: Card[];
  bucharooCount: number;
  bucharooTaken: boolean;
  bucharooTakenByTeamId: TeamId | null;
  bucharooTakenByPlayerId: string | null;

  wildCard: Card | null;
  wildRank: NaturalRank | null;

  melds: Meld[];
  scoreHistory: RoundScoreRecord[];
  winningTeamId: TeamId | null;
  log: LogEntry[];
  stateVersion: number;
}

const LOG_TAIL = 60;

export function viewFor(state: GameState, viewerId: string | null): GameView {
  const players: OpponentView[] = state.players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    seat: player.seat,
    teamId: player.teamId,
    handCount: player.hand.length,
    handType: player.handType,
  }));

  const self = state.players.find((p) => p.id === viewerId);

  return {
    roomId: state.roomId,
    status: state.status,
    roundNumber: state.roundNumber,
    targetScore: state.targetScore,

    you: self
      ? {
          id: self.id,
          displayName: self.displayName,
          seat: self.seat,
          teamId: self.teamId,
          handCount: self.hand.length,
          handType: self.handType,
          hand: self.hand,
        }
      : null,
    players,
    teams: {
      TEAM_A: teamView(state, 'TEAM_A'),
      TEAM_B: teamView(state, 'TEAM_B'),
    },

    dealerPlayerId: state.dealerPlayerId,
    currentPlayerId: state.currentPlayerId,
    turnPhase: state.turnPhase,
    hasDrawnThisTurn: state.hasDrawnThisTurn,

    stockCount: state.stock.length,
    discardPile: state.discardPile,
    bucharooCount: state.bucharoo.length,
    bucharooTaken: state.bucharooTaken,
    bucharooTakenByTeamId: state.bucharooTakenByTeamId,
    bucharooTakenByPlayerId: state.bucharooTakenByPlayerId,

    wildCard: state.wildCard,
    wildRank: state.wildRank,

    melds: state.melds,
    scoreHistory: state.scoreHistory,
    winningTeamId: state.winningTeamId,
    log: state.log.slice(-LOG_TAIL),
    stateVersion: state.stateVersion,
  };
}

function teamView(state: GameState, teamId: TeamId): TeamView {
  const team = state.teams[teamId];
  return {
    id: team.id,
    name: team.name,
    playerIds: team.playerIds,
    isOpened: team.isOpened,
    matchScore: team.matchScore,
    tookBucharoo: team.tookBucharoo,
    wentOut: team.wentOut,
  };
}
