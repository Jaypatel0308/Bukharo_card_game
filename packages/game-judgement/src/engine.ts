import { buildDeck, cardLabel, rankValue } from './cards.js';
import { shuffle, type Rng } from './random.js';
import {
  cardsForRound,
  forbiddenBidFor,
  scoreFor,
  trumpForRound,
  type JudgementRules,
} from './rules.js';
import type {
  Card,
  CompletedTrick,
  JudgementPlayer,
  JudgementState,
  Play,
  RoundResult,
  Suit,
} from './types.js';

const MAX_LOG_ENTRIES = 300;
const MAX_ROUND_HISTORY = 50;

export type JudgementAction =
  | { type: 'PLACE_BID'; playerId: string; bid: number }
  | { type: 'PLAY_CARD'; playerId: string; cardId: string };

export type JudgementResult =
  | { ok: true; state: JudgementState; events: Array<{ type: string; payload: Record<string, unknown> }> }
  | { ok: false; code: string; message: string };

function fail(code: string, message: string): JudgementResult {
  return { ok: false, code, message };
}

function draftOf(state: JudgementState): JudgementState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    currentTrick: { ...state.currentTrick, plays: [...state.currentTrick.plays] },
    completedTricks: [...state.completedTricks],
    roundHistory: [...state.roundHistory],
    winnerPlayerIds: [...state.winnerPlayerIds],
    log: [...state.log],
    undealt: [...state.undealt],
    stateVersion: state.stateVersion + 1,
  };
}

function log(
  draft: JudgementState,
  playerId: string | null,
  type: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  draft.log.push({
    seq: (draft.log[draft.log.length - 1]?.seq ?? 0) + 1,
    // Engines have no clock; the server stamps these on the way out.
    timestamp: 0,
    playerId,
    type,
    message,
    ...(data ? { data } : {}),
  });
  if (draft.log.length > MAX_LOG_ENTRIES) {
    draft.log.splice(0, draft.log.length - MAX_LOG_ENTRIES);
  }
}

export function playerById(state: JudgementState, id: string): JudgementPlayer | undefined {
  return state.players.find((p) => p.id === id);
}

/** Seating order, so "the next player" always means the same thing. */
function nextPlayerId(state: JudgementState, playerId: string): string {
  const order = [...state.players].sort((a, b) => a.position - b.position);
  const index = order.findIndex((p) => p.id === playerId);
  return order[(index + 1) % order.length]!.id;
}

export interface CreateJudgementOptions {
  roomId: string;
  seats: Array<{ id: string; displayName: string; position: number }>;
  rules: JudgementRules;
  rng: Rng;
}

export function createJudgementMatch(options: CreateJudgementOptions): JudgementState {
  const { roomId, seats, rules, rng } = options;
  const players: JudgementPlayer[] = seats
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((seat) => ({
      id: seat.id,
      displayName: seat.displayName,
      position: seat.position,
      hand: [],
      bid: null,
      tricksWon: 0,
      score: 0,
    }));

  // §14 — the first starter is chosen at random; after that it simply rotates.
  const first = players[rng.nextInt(players.length)]!;

  const state: JudgementState = {
    roomId,
    status: 'BIDDING',
    roundNumber: 0,
    totalRounds: rules.totalRounds,
    cardsEach: 0,
    trump: 'spades',
    players,
    startingPlayerId: first.id,
    dealerId: first.id,
    currentPlayerId: first.id,
    currentTrick: { leadSuit: null, plays: [] },
    completedTricks: [],
    undealt: [],
    roundHistory: [],
    winnerPlayerIds: [],
    log: [],
    stateVersion: 0,
  };

  return dealRound(state, rng, first.id);
}

/**
 * Deals the next round: new hands, new trump, everyone back to no bid.
 *
 * The starting player is passed in rather than derived, because round one
 * picks at random and every round after moves one seat on (§15).
 */
function dealRound(state: JudgementState, rng: Rng, startingPlayerId: string): JudgementState {
  const draft = draftOf(state);
  draft.roundNumber = state.roundNumber + 1;
  draft.cardsEach = cardsForRound(draft.roundNumber, draft.players.length);
  draft.trump = trumpForRound(draft.roundNumber);
  draft.startingPlayerId = startingPlayerId;
  // §16 — the dealer is immediately left of whoever bids and leads first.
  draft.dealerId = nextPlayerId(draft, startingPlayerId);
  draft.currentPlayerId = startingPlayerId;
  draft.status = 'BIDDING';
  draft.currentTrick = { leadSuit: null, plays: [] };
  draft.completedTricks = [];

  const deck = shuffle(buildDeck(), rng);
  let at = 0;
  for (const player of draft.players) {
    player.hand = deck.slice(at, at + draft.cardsEach);
    at += draft.cardsEach;
    player.bid = null;
    player.tricksWon = 0;
  }
  // §19 — whatever will not divide is set aside, unseen and unplayed.
  draft.undealt = deck.slice(at);

  log(
    draft,
    null,
    'ROUND_STARTED',
    `Round ${draft.roundNumber} of ${draft.totalRounds}: ${draft.cardsEach} card${
      draft.cardsEach === 1 ? '' : 's'
    } each, ${draft.trump} are trump.`,
    { roundNumber: draft.roundNumber, cardsEach: draft.cardsEach, trump: draft.trump },
  );
  return draft;
}

/** §54, §77 — score the round, then deal the next unless the match is over. */
export function startNextRound(state: JudgementState, rng: Rng): JudgementState {
  if (state.status !== 'ROUND_END') return state;
  // §15 — the lead moves one seat on each round.
  return dealRound(state, rng, nextPlayerId(state, state.startingPlayerId));
}

/** The bids already placed this round, in seating order from the starter. */
function bidsPlaced(state: JudgementState): number[] {
  const order = biddingOrder(state);
  const placed: number[] = [];
  for (const player of order) {
    if (player.bid === null) break;
    placed.push(player.bid);
  }
  return placed;
}

function biddingOrder(state: JudgementState): JudgementPlayer[] {
  const sorted = [...state.players].sort((a, b) => a.position - b.position);
  const start = sorted.findIndex((p) => p.id === state.startingPlayerId);
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

/**
 * §25, §27 — what this player may legally judge.
 *
 * Everyone may say anything from nothing up to every trick; only the final
 * bidder is restricted, and only from the one number that would make the bids
 * add up exactly.
 */
export function legalBidsFor(state: JudgementState, playerId: string): number[] {
  if (state.status !== 'BIDDING' || state.currentPlayerId !== playerId) return [];
  const all = Array.from({ length: state.cardsEach + 1 }, (_, i) => i);
  const forbidden = forbiddenBidFor(bidsPlaced(state), state.players.length, state.cardsEach);
  return forbidden === null ? all : all.filter((bid) => bid !== forbidden);
}

function placeBid(state: JudgementState, playerId: string, bid: number): JudgementResult {
  if (state.status !== 'BIDDING') return fail('WRONG_PHASE', 'Bidding is over for this round.');
  if (state.currentPlayerId !== playerId) return fail('NOT_YOUR_TURN', 'It is not your turn to bid.');
  if (!Number.isInteger(bid)) return fail('BAD_BID', 'A judgement must be a whole number.');

  const legal = legalBidsFor(state, playerId);
  if (!legal.includes(bid)) {
    const forbidden = forbiddenBidFor(bidsPlaced(state), state.players.length, state.cardsEach);
    if (forbidden === bid) {
      return fail(
        'BID_COMPLETES_COUNT',
        `You cannot judge ${bid} — the bids would add up to ${state.cardsEach}, and somebody must be wrong.`,
      );
    }
    return fail('BAD_BID', `Judge between 0 and ${state.cardsEach}.`);
  }

  const draft = draftOf(state);
  const player = playerById(draft, playerId)!;
  player.bid = bid;
  log(draft, playerId, 'BID_PLACED', `${player.displayName} judged ${bid}.`, { bid });

  const order = biddingOrder(draft);
  const nextToBid = order.find((p) => p.bid === null);
  if (nextToBid) {
    draft.currentPlayerId = nextToBid.id;
  } else {
    // §31, §32 — everyone has judged, so the first bidder leads.
    draft.status = 'PLAYING';
    draft.currentPlayerId = draft.startingPlayerId;
    const total = draft.players.reduce((sum, p) => sum + (p.bid ?? 0), 0);
    log(
      draft,
      null,
      'BIDDING_DONE',
      `All judged: ${total} between them for ${draft.cardsEach} trick${
        draft.cardsEach === 1 ? '' : 's'
      }.`,
      { total, tricks: draft.cardsEach },
    );
  }

  return { ok: true, state: draft, events: [] };
}

/** §33 — you must follow the suit that was led, if you hold it. */
export function legalCardIdsFor(state: JudgementState, playerId: string): string[] {
  if (state.status !== 'PLAYING' || state.currentPlayerId !== playerId) return [];
  const player = playerById(state, playerId);
  if (!player) return [];
  const lead = state.currentTrick.leadSuit;
  if (lead) {
    const following = player.hand.filter((card) => card.suit === lead);
    // §35, §36 — with none of the lead suit, anything goes. Trump is never
    // compulsory, which is most of the game's strategy.
    if (following.length > 0) return following.map((card) => card.id);
  }
  return player.hand.map((card) => card.id);
}

/** §37–39 — highest trump, or failing that the highest card of the lead suit. */
export function winnerOfTrick(plays: Play[], leadSuit: Suit, trump: Suit): string {
  let best = plays[0]!;
  for (const play of plays.slice(1)) {
    const bestIsTrump = best.card.suit === trump;
    const playIsTrump = play.card.suit === trump;
    if (playIsTrump && !bestIsTrump) {
      best = play;
    } else if (playIsTrump === bestIsTrump) {
      const relevant = bestIsTrump ? trump : leadSuit;
      if (
        play.card.suit === relevant &&
        best.card.suit === relevant &&
        rankValue(play.card.rank) > rankValue(best.card.rank)
      ) {
        best = play;
      }
    }
  }
  return best.playerId;
}

function playCard(state: JudgementState, playerId: string, cardId: string): JudgementResult {
  if (state.status !== 'PLAYING') return fail('WRONG_PHASE', 'There is no trick to play into.');
  if (state.currentPlayerId !== playerId) return fail('NOT_YOUR_TURN', 'It is not your turn.');

  const draft = draftOf(state);
  const player = playerById(draft, playerId)!;
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return fail('CARD_NOT_IN_HAND', 'That card is not in your hand.');

  const lead = draft.currentTrick.leadSuit;
  if (lead && card.suit !== lead && player.hand.some((c) => c.suit === lead)) {
    return fail('MUST_FOLLOW_SUIT', `You hold ${lead}, so you must follow.`);
  }

  player.hand = player.hand.filter((c) => c.id !== cardId);
  draft.currentTrick.plays.push({ playerId, card });
  if (!draft.currentTrick.leadSuit) draft.currentTrick.leadSuit = card.suit;
  log(draft, playerId, 'CARD_PLAYED', `${player.displayName} played ${cardLabel(card)}.`, {
    card,
  });

  if (draft.currentTrick.plays.length < draft.players.length) {
    draft.currentPlayerId = nextPlayerId(draft, playerId);
    return { ok: true, state: draft, events: [] };
  }

  // The trick is full: settle it.
  const leadSuit = draft.currentTrick.leadSuit!;
  const winnerId = winnerOfTrick(draft.currentTrick.plays, leadSuit, draft.trump);
  const winner = playerById(draft, winnerId)!;
  winner.tricksWon += 1;

  const finished: CompletedTrick = {
    leadSuit,
    plays: [...draft.currentTrick.plays],
    winnerPlayerId: winnerId,
  };
  draft.completedTricks.push(finished);
  draft.currentTrick = { leadSuit: null, plays: [] };
  log(draft, winnerId, 'TRICK_WON', `${winner.displayName} took the trick.`, {
    tricksWon: winner.tricksWon,
    bid: winner.bid,
  });

  // §40 — the winner leads the next one.
  draft.currentPlayerId = winnerId;

  if (draft.completedTricks.length === draft.cardsEach) return endRound(draft);
  return { ok: true, state: draft, events: [] };
}

/** §54 — compare each judgement against what actually happened. */
function endRound(draft: JudgementState): JudgementResult {
  const lines: RoundResult['lines'] = [];
  for (const player of draft.players) {
    const bid = player.bid ?? 0;
    const scored = scoreFor(bid, player.tricksWon);
    player.score += scored;
    lines.push({
      playerId: player.id,
      bid,
      tricksWon: player.tricksWon,
      scored,
      scoreAfter: player.score,
    });
  }

  draft.roundHistory.push({
    roundNumber: draft.roundNumber,
    trump: draft.trump,
    cardsEach: draft.cardsEach,
    lines,
  });
  if (draft.roundHistory.length > MAX_ROUND_HISTORY) {
    draft.roundHistory.splice(0, draft.roundHistory.length - MAX_ROUND_HISTORY);
  }

  const made = lines.filter((line) => line.scored > 0).length;
  log(
    draft,
    null,
    'ROUND_ENDED',
    `Round ${draft.roundNumber}: ${made} of ${draft.players.length} judged right.`,
    { roundNumber: draft.roundNumber },
  );

  if (draft.roundNumber >= draft.totalRounds) {
    // §56, §57 — highest total takes it, and a tie is a shared win.
    const best = Math.max(...draft.players.map((p) => p.score));
    draft.winnerPlayerIds = draft.players.filter((p) => p.score === best).map((p) => p.id);
    draft.status = 'MATCH_END';
    const names = draft.players
      .filter((p) => draft.winnerPlayerIds.includes(p.id))
      .map((p) => p.displayName);
    log(
      draft,
      null,
      'MATCH_ENDED',
      names.length === 1
        ? `${names[0]} wins with ${best}.`
        : `${names.join(' and ')} share the win on ${best}.`,
      { winnerPlayerIds: draft.winnerPlayerIds, score: best },
    );
  } else {
    draft.status = 'ROUND_END';
  }

  return { ok: true, state: draft, events: [] };
}

export function applyJudgementAction(
  state: JudgementState,
  action: JudgementAction,
): JudgementResult {
  switch (action.type) {
    case 'PLACE_BID':
      return placeBid(state, action.playerId, action.bid);
    case 'PLAY_CARD':
      return playCard(state, action.playerId, action.cardId);
    default:
      return fail('UNKNOWN_ACTION', 'That is not something you can do.');
  }
}

/**
 * Moves past a player who has gone, taking the least consequential option: the
 * lowest legal judgement, and the lowest card they are allowed to play.
 */
export function forceSkipTurn(state: JudgementState, reason: string): JudgementState {
  const playerId = state.currentPlayerId;
  const player = playerById(state, playerId);
  if (!player) return state;

  if (state.status === 'BIDDING') {
    const legal = legalBidsFor(state, playerId);
    const bid = legal[0] ?? 0;
    const result = placeBid(state, playerId, bid);
    if (!result.ok) return state;
    log(result.state, playerId, 'FORCED_BID', `${player.displayName} judged ${bid} (${reason}).`);
    return result.state;
  }

  if (state.status === 'PLAYING') {
    const legalIds = new Set(legalCardIdsFor(state, playerId));
    const lowest = player.hand
      .filter((card) => legalIds.has(card.id))
      .sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0];
    if (!lowest) return state;
    const result = playCard(state, playerId, lowest.id);
    if (!result.ok) return state;
    log(
      result.state,
      playerId,
      'FORCED_PLAY',
      `${player.displayName} played ${cardLabel(lowest)} (${reason}).`,
    );
    return result.state;
  }

  return state;
}

export type { Card, JudgementState };
