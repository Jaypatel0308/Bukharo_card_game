import type {
  Card,
  CompletedTrick,
  LogEntry,
  MindiPlayer,
  MindiState,
  Suit,
  TeamId,
  Trick,
  TrumpMode,
} from './types.js';

/**
 * The redaction boundary.
 *
 * The only function permitted to turn Mindi state into something a client may
 * see. Two things are secret here rather than one: a player's hand, and the
 * face-down trump — which is sent to the player who hid it and to nobody else.
 * In the physical game you must trust the hider to report that card honestly;
 * here they could not misreport it if they wanted to.
 */

export interface MindiOpponentView {
  id: string;
  displayName: string;
  position: number;
  teamId: TeamId;
  handCount: number;
}

export interface MindiSelfView extends MindiOpponentView {
  hand: Card[];
}

export interface MindiTeamView {
  id: TeamId;
  name: string;
  playerIds: string[];
  kot: number;
  mindisThisHand: number;
  tricksThisHand: number;
}

export interface MindiView {
  roomId: string;
  status: MindiState['status'];
  handNumber: number;
  kotTarget: number;

  you: MindiSelfView | null;
  players: MindiOpponentView[];
  teams: Record<TeamId, MindiTeamView>;

  dealerId: string;
  chooserId: string;
  currentPlayerId: string;

  mode: TrumpMode | null;
  trumpSuit: Suit | null;
  trumpActive: boolean;
  hiddenRevealed: boolean;
  /** True when a face-down card is still waiting, without saying what it is. */
  hiddenCardWaiting: boolean;
  /** The face-down card itself — only ever for the player who hid it. */
  yourHiddenCard: Card | null;
  mustPlayTrumpBy: string | null;

  currentTrick: Trick;
  tricksPlayed: number;
  lastTrick: CompletedTrick | null;

  handHistory: MindiState['handHistory'];
  losingTeamId: TeamId | null;
  log: LogEntry[];
  stateVersion: number;
}

const LOG_TAIL = 60;
/** The table shows the hand just finished; the rest is never read. */
const HISTORY_TAIL = 12;

/**
 * Whether this player is sitting on the hidden card with nothing else left.
 *
 * Only then does the card count as part of the hand: it comes back unrevealed
 * and is played as an ordinary card, its suit never becoming trump.
 */
function holdsHiddenCard(state: MindiState, player: MindiPlayer): boolean {
  return player.id === state.chooserId && state.hiddenCard !== null && player.hand.length === 0;
}

/**
 * The cards a player still owes to the hand.
 *
 * Public on purpose: everyone knows a card is face down and whose it is, so
 * counting it keeps the table honest about who has yet to play.
 */
function handCountOf(state: MindiState, player: MindiPlayer): number {
  return player.hand.length + (holdsHiddenCard(state, player) ? 1 : 0);
}

export function viewMindiFor(state: MindiState, viewerId: string | null): MindiView {
  const self = state.players.find((p) => p.id === viewerId);

  return {
    roomId: state.roomId,
    status: state.status,
    handNumber: state.handNumber,
    kotTarget: state.kotTarget,

    you: self
      ? {
          id: self.id,
          displayName: self.displayName,
          position: self.position,
          teamId: self.teamId,
          handCount: handCountOf(state, self),
          // The chooser's unrevealed card is theirs to play once nothing else
          // is left, so it belongs in their hand here. They can already see it
          // through `yourHiddenCard`; leaving it out only made the last trick
          // unplayable, with no card to pick and no id to send.
          hand: holdsHiddenCard(state, self) ? [...self.hand, state.hiddenCard!] : self.hand,
        }
      : null,
    players: state.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      position: player.position,
      teamId: player.teamId,
      handCount: handCountOf(state, player),
    })),
    teams: {
      TEAM_A: teamView(state, 'TEAM_A'),
      TEAM_B: teamView(state, 'TEAM_B'),
    },

    dealerId: state.dealerId,
    chooserId: state.chooserId,
    currentPlayerId: state.currentPlayerId,

    mode: state.mode,
    trumpSuit: state.trumpSuit,
    trumpActive: state.trumpActive,
    hiddenRevealed: state.hiddenRevealed,
    hiddenCardWaiting: state.hiddenCard !== null,
    yourHiddenCard: viewerId === state.chooserId ? state.hiddenCard : null,
    mustPlayTrumpBy: state.mustPlayTrumpBy,

    currentTrick: state.currentTrick,
    tricksPlayed: state.completedTricks.length,
    lastTrick: state.completedTricks[state.completedTricks.length - 1] ?? null,

    handHistory: state.handHistory.slice(-HISTORY_TAIL),
    losingTeamId: state.losingTeamId,
    log: state.log.slice(-LOG_TAIL),
    stateVersion: state.stateVersion,
  };
}

function teamView(state: MindiState, teamId: TeamId): MindiTeamView {
  const team = state.teams[teamId];
  return {
    id: team.id,
    name: team.name,
    playerIds: team.playerIds,
    kot: team.kot,
    mindisThisHand: team.mindisThisHand,
    tricksThisHand: team.tricksThisHand,
  };
}
