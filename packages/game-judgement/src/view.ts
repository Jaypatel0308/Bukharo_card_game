import { legalBidsFor, legalCardIdsFor, playerById } from './engine.js';
import type {
  Card,
  CompletedTrick,
  JudgementState,
  LogEntry,
  RoundResult,
  Suit,
  Trick,
} from './types.js';

const LOG_TAIL = 60;
const HISTORY_TAIL = 12;

/**
 * The one place a state becomes something a player may see.
 *
 * Only the viewer's own hand crosses. Everyone else is a count, and the cards
 * left aside at the deal (§19) are never sent to anybody at all — they are not
 * in play, and shipping them would hand every client a list of cards nobody
 * can hold.
 */
export interface JudgementPlayerView {
  id: string;
  displayName: string;
  position: number;
  handCount: number;
  bid: number | null;
  tricksWon: number;
  score: number;
}

export interface JudgementView {
  status: JudgementState['status'];
  roundNumber: number;
  totalRounds: number;
  cardsEach: number;
  trump: Suit;

  you: (JudgementPlayerView & { hand: Card[] }) | null;
  players: JudgementPlayerView[];

  startingPlayerId: string;
  dealerId: string;
  currentPlayerId: string;

  /** Only for the player on turn, and only while they are bidding. */
  yourLegalBids: number[];
  /** Only for the player on turn; empty otherwise. */
  yourLegalCardIds: string[];

  currentTrick: Trick;
  lastTrick: CompletedTrick | null;
  tricksPlayed: number;

  /** §26 — every judgement is public, and the game turns on reading them. */
  bidsTotal: number;
  roundHistory: RoundResult[];
  winnerPlayerIds: string[];
  log: LogEntry[];
  stateVersion: number;
}

export function viewJudgementFor(state: JudgementState, viewerId: string | null): JudgementView {
  const self = viewerId ? playerById(state, viewerId) : undefined;

  const summarise = (id: string): JudgementPlayerView => {
    const player = playerById(state, id)!;
    return {
      id: player.id,
      displayName: player.displayName,
      position: player.position,
      handCount: player.hand.length,
      bid: player.bid,
      tricksWon: player.tricksWon,
      score: player.score,
    };
  };

  return {
    status: state.status,
    roundNumber: state.roundNumber,
    totalRounds: state.totalRounds,
    cardsEach: state.cardsEach,
    trump: state.trump,

    you: self ? { ...summarise(self.id), hand: self.hand } : null,
    players: state.players.map((p) => summarise(p.id)),

    startingPlayerId: state.startingPlayerId,
    dealerId: state.dealerId,
    currentPlayerId: state.currentPlayerId,

    yourLegalBids: self ? legalBidsFor(state, self.id) : [],
    yourLegalCardIds: self ? legalCardIdsFor(state, self.id) : [],

    currentTrick: state.currentTrick,
    lastTrick: state.completedTricks[state.completedTricks.length - 1] ?? null,
    tricksPlayed: state.completedTricks.length,

    bidsTotal: state.players.reduce((sum, p) => sum + (p.bid ?? 0), 0),
    roundHistory: state.roundHistory.slice(-HISTORY_TAIL),
    winnerPlayerIds: state.winnerPlayerIds,
    log: state.log.slice(-LOG_TAIL),
    stateVersion: state.stateVersion,
  };
}
