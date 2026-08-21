import { buildDeck, cardLabel, countMindis, rankValue } from './cards.js';
import { pick, shuffle, type Rng } from './random.js';
import type { MindiRules } from './rules.js';
import type {
  Card,
  CompletedTrick,
  HandResult,
  MindiAction,
  MindiError,
  MindiErrorCode,
  MindiEvent,
  MindiPlayer,
  MindiResult,
  MindiState,
  Play,
  Suit,
  TeamId,
  TrumpMode,
} from './types.js';

export const TEAM_IDS: TeamId[] = ['TEAM_A', 'TEAM_B'];

export const DEFAULT_TEAM_NAMES: Record<TeamId, string> = {
  TEAM_A: 'Team A',
  TEAM_B: 'Team B',
};

/** §5 — teams alternate around the table, so a position's side is its parity. */
export function teamForPosition(position: number): TeamId {
  return position % 2 === 0 ? 'TEAM_A' : 'TEAM_B';
}

export interface SeatAssignment {
  id: string;
  displayName: string;
  position: number;
}

function fail(code: MindiErrorCode, message: string): MindiError {
  return { ok: false, code, message };
}

/** Copy-on-write draft. Cards are immutable and safely shared. */
function draftOf(state: MindiState): MindiState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    teams: {
      TEAM_A: { ...state.teams.TEAM_A, playerIds: [...state.teams.TEAM_A.playerIds] },
      TEAM_B: { ...state.teams.TEAM_B, playerIds: [...state.teams.TEAM_B.playerIds] },
    },
    currentTrick: { ...state.currentTrick, plays: [...state.currentTrick.plays] },
    completedTricks: [...state.completedTricks],
    handHistory: [...state.handHistory],
    log: [...state.log],
  };
}

const MAX_LOG_ENTRIES = 300;

function log(draft: MindiState, playerId: string | null, type: string, message: string): void {
  draft.seqCounter += 1;
  draft.log.push({
    seq: draft.seqCounter,
    handNumber: draft.handNumber,
    timestamp: draft.log.length, // replaced with a wall clock by the server layer
    playerId,
    type,
    message,
  });
  if (draft.log.length > MAX_LOG_ENTRIES) {
    draft.log.splice(0, draft.log.length - MAX_LOG_ENTRIES);
  }
}

export function playerById(state: MindiState, playerId: string): MindiPlayer | undefined {
  return state.players.find((p) => p.id === playerId);
}

function byPosition(state: MindiState): MindiPlayer[] {
  return [...state.players].sort((a, b) => a.position - b.position);
}

/** §10 — play proceeds around the table in seating order. */
function nextPlayerId(state: MindiState, playerId: string): string {
  const order = byPosition(state);
  const index = order.findIndex((p) => p.id === playerId);
  return order[(index + 1) % order.length]!.id;
}

function teamName(state: MindiState, teamId: TeamId): string {
  return state.teams[teamId].name || DEFAULT_TEAM_NAMES[teamId];
}

/* ------------------------------------------------------------------ */
/* Setting up                                                          */
/* ------------------------------------------------------------------ */

export interface CreateMindiOptions {
  roomId: string;
  seats: SeatAssignment[];
  rules: MindiRules;
  rng: Rng;
  teamNames?: Partial<Record<TeamId, string>>;
}

export function createMindiMatch(options: CreateMindiOptions): MindiState {
  const { roomId, seats, rules, rng, teamNames } = options;
  if (![4, 6, 8].includes(seats.length)) {
    throw new Error(`Mindi seats 4, 6 or 8 players, not ${seats.length}`);
  }

  const players: MindiPlayer[] = seats.map((seat) => ({
    id: seat.id,
    displayName: seat.displayName,
    position: seat.position,
    teamId: teamForPosition(seat.position),
    hand: [],
  }));

  const team = (id: TeamId) => ({
    id,
    name: teamNames?.[id]?.trim() || DEFAULT_TEAM_NAMES[id],
    playerIds: players.filter((p) => p.teamId === id).map((p) => p.id),
    kot: 0,
    mindisThisHand: 0,
    tricksThisHand: 0,
  });

  // §14 — for the first hand both roles are drawn at random.
  const dealer = pick(players, rng);
  const chooser = pick(players, rng);

  const base: MindiState = {
    roomId,
    status: 'CHOOSING_MODE',
    handNumber: 0,
    kotTarget: rules.kotTarget,
    players,
    teams: { TEAM_A: team('TEAM_A'), TEAM_B: team('TEAM_B') },
    dealerId: dealer.id,
    chooserId: chooser.id,
    mode: null,
    hiddenCard: null,
    hiddenRevealed: false,
    trumpSuit: null,
    trumpActive: false,
    mustPlayTrumpBy: null,
    currentPlayerId: dealer.id,
    currentTrick: { leadSuit: null, plays: [] },
    completedTricks: [],
    handHistory: [],
    losingTeamId: null,
    log: [],
    stateVersion: 0,
    seqCounter: 0,
  };

  return dealHand(base, rules, rng);
}

/** §7 — every card is dealt, so every trick is full and the hand ends clean. */
export function dealHand(state: MindiState, rules: MindiRules, rng: Rng): MindiState {
  const draft = draftOf(state);
  draft.handNumber += 1;

  const deck = shuffle(buildDeck(draft.players.length), rng);
  const perPlayer = deck.length / draft.players.length;

  // §9 — dealing starts to the dealer's left, as does the first lead.
  const order: MindiPlayer[] = [];
  let cursor = nextPlayerId(draft, draft.dealerId);
  for (let i = 0; i < draft.players.length; i++) {
    order.push(playerById(draft, cursor)!);
    cursor = nextPlayerId(draft, cursor);
  }
  for (const player of draft.players) player.hand = [];
  for (let round = 0; round < perPlayer; round++) {
    for (const player of order) player.hand.push(deck.pop()!);
  }

  draft.mode = null;
  draft.hiddenCard = null;
  draft.hiddenRevealed = false;
  draft.trumpSuit = null;
  draft.trumpActive = false;
  draft.mustPlayTrumpBy = null;
  draft.currentTrick = { leadSuit: null, plays: [] };
  draft.completedTricks = [];
  for (const id of TEAM_IDS) {
    draft.teams[id].mindisThisHand = 0;
    draft.teams[id].tricksThisHand = 0;
  }
  draft.currentPlayerId = nextPlayerId(draft, draft.dealerId);
  draft.status = 'CHOOSING_MODE';
  draft.stateVersion += 1;

  const chooser = playerById(draft, draft.chooserId)!;
  log(
    draft,
    null,
    'HAND_DEALT',
    `Hand ${draft.handNumber} dealt, ${perPlayer} cards each. ${chooser.displayName} decides how trump is set.`,
  );
  void rules;
  return draft;
}

/* ------------------------------------------------------------------ */
/* Trick resolution                                                    */
/* ------------------------------------------------------------------ */

/** Later of two identical cards wins (§41), so ties go to the later play. */
function bestPlay(plays: Play[]): Play {
  let best = plays[0]!;
  for (const play of plays.slice(1)) {
    if (rankValue(play.card.rank) >= rankValue(best.card.rank)) best = play;
  }
  return best;
}

/**
 * Who takes the trick, and whether it settles Katte.
 *
 * A Katte trick is resolved on its own terms: every off-suit card in it is a
 * candidate (only a void player can play one), the highest candidate sets
 * trump, and that same card takes the trick. Ties there follow the same
 * later-card rule as duplicates.
 */
function resolveTrick(
  plays: Play[],
  leadSuit: Suit,
  establishesKatte: boolean,
): { winner: Play; newTrump: Suit | null } {
  if (establishesKatte) {
    const candidates = plays.filter((play) => play.card.suit !== leadSuit);
    if (candidates.length > 0) {
      const winner = bestPlay(candidates);
      return { winner, newTrump: winner.card.suit };
    }
    return { winner: bestPlay(plays.filter((p) => p.card.suit === leadSuit)), newTrump: null };
  }

  const trumps = plays.filter((play) => play.countedAsTrump);
  if (trumps.length > 0) return { winner: bestPlay(trumps), newTrump: null };
  return { winner: bestPlay(plays.filter((p) => p.card.suit === leadSuit)), newTrump: null };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function applyMindiAction(
  state: MindiState,
  action: MindiAction,
  rules: MindiRules,
  rng: Rng,
): MindiResult {
  switch (action.type) {
    case 'CHOOSE_MODE':
      return chooseMode(state, action.playerId, action.mode, rules, rng);
    case 'REVEAL_TRUMP':
      return revealTrump(state, action.playerId, rules);
    case 'PLAY_CARD':
      return playCard(state, action.playerId, action.cardId, rules);
    default:
      return fail('WRONG_PHASE', 'That action was not understood.');
  }
}

/** §80 step 1 — the chooser either hides a card or calls Katte. */
function chooseMode(
  state: MindiState,
  playerId: string,
  mode: TrumpMode,
  rules: MindiRules,
  rng: Rng,
): MindiResult {
  if (state.status !== 'CHOOSING_MODE') {
    return fail('WRONG_PHASE', 'Trump has already been settled for this hand.');
  }
  if (playerId !== state.chooserId) {
    const chooser = playerById(state, state.chooserId);
    return fail('NOT_THE_CHOOSER', `${chooser?.displayName ?? 'Another player'} decides this hand.`);
  }
  if (mode !== 'HIDDEN' && mode !== 'KATTE') {
    return fail('WRONG_PHASE', 'Choose either a hidden trump or Katte.');
  }

  const draft = draftOf(state);
  const chooser = playerById(draft, playerId)!;
  draft.mode = mode;
  const events: MindiEvent[] = [];

  if (mode === 'HIDDEN') {
    // The card is drawn at random from their hand, and stays out of it until
    // revealed — so its suit is one they may be unable to follow meanwhile.
    const index = rules.hiddenCardChosenRandomly ? rng.nextInt(chooser.hand.length) : 0;
    const [hidden] = chooser.hand.splice(index, 1);
    draft.hiddenCard = hidden!;
    log(draft, playerId, 'TRUMP_HIDDEN', `${chooser.displayName} hid a card for trump.`);
    events.push({
      type: 'HIDDEN_CARD',
      privateToPlayerId: playerId,
      payload: { card: hidden },
    });
  } else {
    log(draft, playerId, 'KATTE_CALLED', `${chooser.displayName} called Katte — no card is hidden.`);
  }

  draft.status = 'PLAYING';
  draft.stateVersion += 1;
  return { ok: true, state: draft, events };
}

/** §17–22 — asked for by a player who cannot follow, never by the hider. */
function revealTrump(state: MindiState, playerId: string, rules: MindiRules): MindiResult {
  if (state.status !== 'PLAYING') return fail('GAME_NOT_PLAYING', 'The hand is not in progress.');
  if (state.currentPlayerId !== playerId) return fail('NOT_YOUR_TURN', 'It is not your turn.');
  if (state.mode !== 'HIDDEN' || !state.hiddenCard || state.hiddenRevealed) {
    return fail('NOTHING_TO_REVEAL', 'There is no hidden card to turn over.');
  }
  if (!rules.chooserMayRevealOwnCard && playerId === state.chooserId) {
    return fail('CANNOT_REVEAL_OWN_CARD', 'You hid the card, so you cannot call for it.');
  }

  const player = playerById(state, playerId)!;
  const leadSuit = state.currentTrick.leadSuit;
  if (leadSuit && player.hand.some((card) => card.suit === leadSuit)) {
    return fail('CAN_STILL_FOLLOW_SUIT', 'You can still follow suit, so the trump stays hidden.');
  }

  const draft = draftOf(state);
  const hidden = draft.hiddenCard!;
  const chooser = playerById(draft, draft.chooserId)!;

  draft.hiddenRevealed = true;
  draft.trumpSuit = hidden.suit;
  draft.trumpActive = true;
  draft.hiddenCard = null;
  // §1 answer — the card goes back to the hand it came from.
  chooser.hand.push(hidden);
  draft.mustPlayTrumpBy = playerId;
  draft.stateVersion += 1;

  log(
    draft,
    playerId,
    'TRUMP_REVEALED',
    `${player.displayName} called for the trump: ${cardLabel(hidden)}. ${hidden.suit} is trump.`,
  );
  return {
    ok: true,
    state: draft,
    events: [{ type: 'TRUMP_REVEALED', payload: { card: hidden, suit: hidden.suit } }],
  };
}

function playCard(
  state: MindiState,
  playerId: string,
  cardId: string,
  rules: MindiRules,
): MindiResult {
  if (state.status !== 'PLAYING') return fail('GAME_NOT_PLAYING', 'The hand is not in progress.');
  if (state.currentPlayerId !== playerId) return fail('NOT_YOUR_TURN', 'It is not your turn.');

  const draft = draftOf(state);
  const player = playerById(draft, playerId)!;

  // If the hidden card is all they have left, it comes back and is played as
  // an ordinary card — its suit never becomes trump.
  if (player.hand.length === 0 && draft.hiddenCard && playerId === draft.chooserId) {
    player.hand.push(draft.hiddenCard);
    draft.hiddenCard = null;
    draft.hiddenRevealed = true;
    log(
      draft,
      playerId,
      'HIDDEN_CARD_SPENT',
      `${player.displayName}'s hidden card came back unrevealed and is played as an ordinary card.`,
    );
  }

  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return fail('CARD_NOT_IN_HAND', 'That card is not in your hand.');

  // §11 — following the lead suit takes priority over everything, trump included.
  const leadSuit = draft.currentTrick.leadSuit;
  if (leadSuit && card.suit !== leadSuit && player.hand.some((c) => c.suit === leadSuit)) {
    return fail('MUST_FOLLOW_SUIT', `You have ${leadSuit}, so you must play ${leadSuit}.`);
  }

  // §22 — whoever called for the reveal must then play that suit if they hold it.
  if (draft.mustPlayTrumpBy === playerId && draft.trumpSuit) {
    const holdsTrump = player.hand.some((c) => c.suit === draft.trumpSuit);
    if (holdsTrump && card.suit !== draft.trumpSuit) {
      return fail('MUST_PLAY_TRUMP', `You called for the trump, so you must play a ${draft.trumpSuit}.`);
    }
  }
  if (rules.mustTrumpWhenVoid && leadSuit && card.suit !== leadSuit && draft.trumpSuit) {
    const holdsTrump = player.hand.some((c) => c.suit === draft.trumpSuit);
    if (holdsTrump && card.suit !== draft.trumpSuit) {
      return fail('MUST_PLAY_TRUMP', 'You must trump when you cannot follow suit.');
    }
  }

  player.hand = player.hand.filter((c) => c.id !== cardId);
  if (draft.mustPlayTrumpBy === playerId) draft.mustPlayTrumpBy = null;

  const play: Play = {
    playerId,
    card,
    // Recorded now, so a trump revealed later in this trick cannot promote it.
    countedAsTrump: draft.trumpActive && card.suit === draft.trumpSuit,
  };
  if (draft.currentTrick.plays.length === 0) draft.currentTrick.leadSuit = card.suit;
  draft.currentTrick.plays.push(play);

  log(draft, playerId, 'CARD_PLAYED', `${player.displayName} played ${cardLabel(card)}.`);

  const events: MindiEvent[] = [
    { type: 'CARD_PLAYED', payload: { playerId, card, handCount: player.hand.length } },
  ];

  if (draft.currentTrick.plays.length < draft.players.length) {
    draft.currentPlayerId = nextPlayerId(draft, playerId);
    draft.stateVersion += 1;
    return { ok: true, state: draft, events };
  }

  return finishTrick(draft, rules, events);
}

function finishTrick(draft: MindiState, rules: MindiRules, events: MindiEvent[]): MindiResult {
  const leadSuit = draft.currentTrick.leadSuit!;
  const establishesKatte = draft.mode === 'KATTE' && draft.trumpSuit === null;

  const { winner, newTrump } = resolveTrick(draft.currentTrick.plays, leadSuit, establishesKatte);

  if (newTrump) {
    draft.trumpSuit = newTrump;
    draft.trumpActive = true;
    log(draft, winner.playerId, 'KATTE_SETTLED', `Katte settled: ${newTrump} is trump.`);
  }

  const winningPlayer = playerById(draft, winner.playerId)!;
  const mindis = countMindis(draft.currentTrick.plays.map((p) => p.card));
  const completed: CompletedTrick = {
    winnerPlayerId: winner.playerId,
    winningTeamId: winningPlayer.teamId,
    plays: draft.currentTrick.plays,
    mindis,
  };
  draft.completedTricks.push(completed);
  draft.teams[winningPlayer.teamId].tricksThisHand += 1;
  draft.teams[winningPlayer.teamId].mindisThisHand += mindis;

  log(
    draft,
    winner.playerId,
    'TRICK_WON',
    `${winningPlayer.displayName} took the trick with ${cardLabel(winner.card)}` +
      (mindis > 0 ? `, capturing ${mindis} Mindi${mindis === 1 ? '' : 's'}.` : '.'),
  );
  events.push({
    type: 'TRICK_WON',
    payload: { winnerPlayerId: winner.playerId, teamId: winningPlayer.teamId, mindis },
  });

  draft.currentTrick = { leadSuit: null, plays: [] };
  // §9 — the winner of a trick leads the next one.
  draft.currentPlayerId = winner.playerId;

  const cardsLeft = draft.players.some((p) => p.hand.length > 0) || draft.hiddenCard !== null;
  if (!cardsLeft) return endHand(draft, rules, events);

  draft.stateVersion += 1;
  return { ok: true, state: draft, events };
}

/* ------------------------------------------------------------------ */
/* Ending a hand and the match                                         */
/* ------------------------------------------------------------------ */

export function endHand(draft: MindiState, rules: MindiRules, events: MindiEvent[]): MindiResult {
  const mindis = {
    TEAM_A: draft.teams.TEAM_A.mindisThisHand,
    TEAM_B: draft.teams.TEAM_B.mindisThisHand,
  };
  const tricks = {
    TEAM_A: draft.teams.TEAM_A.tricksThisHand,
    TEAM_B: draft.teams.TEAM_B.tricksThisHand,
  };

  // §48–51 — Mindis decide it; tricks only settle an even split. The total
  // number of tricks is always odd, so tricks cannot tie in turn.
  let winningTeamId: TeamId;
  let decidedBy: HandResult['decidedBy'];
  if (mindis.TEAM_A !== mindis.TEAM_B) {
    winningTeamId = mindis.TEAM_A > mindis.TEAM_B ? 'TEAM_A' : 'TEAM_B';
    decidedBy = 'MINDIS';
  } else {
    winningTeamId = tricks.TEAM_A > tricks.TEAM_B ? 'TEAM_A' : 'TEAM_B';
    decidedBy = 'TRICKS';
  }
  const losingTeamId: TeamId = winningTeamId === 'TEAM_A' ? 'TEAM_B' : 'TEAM_A';

  // §53–57 — a clean sweep gives the swept team a Kot and takes one off the
  // sweeper's own tally, which cannot fall below zero.
  const sweep = mindis[losingTeamId] === 0;
  if (sweep) {
    draft.teams[losingTeamId].kot += 1;
    draft.teams[winningTeamId].kot = Math.max(0, draft.teams[winningTeamId].kot - 1);
  }

  const result: HandResult = {
    handNumber: draft.handNumber,
    winningTeamId,
    decidedBy,
    mindis,
    tricks,
    sweep,
    kotAfter: { TEAM_A: draft.teams.TEAM_A.kot, TEAM_B: draft.teams.TEAM_B.kot },
  };
  draft.handHistory.push(result);

  log(
    draft,
    null,
    'HAND_ENDED',
    `${teamName(draft, winningTeamId)} won hand ${draft.handNumber} ` +
      `(${mindis[winningTeamId]}–${mindis[losingTeamId]} Mindis` +
      `${decidedBy === 'TRICKS' ? `, decided on tricks ${tricks[winningTeamId]}–${tricks[losingTeamId]}` : ''})` +
      `${sweep ? `. A clean sweep: ${teamName(draft, losingTeamId)} take a Kot.` : '.'}`,
  );

  // §8 and §14 — the losers deal next, a winner hides next.
  draft.dealerId = pickFrom(draft, losingTeamId);
  draft.chooserId = pickFrom(draft, winningTeamId);

  const out = TEAM_IDS.find((id) => draft.teams[id].kot >= rules.kotTarget) ?? null;
  draft.losingTeamId = out;
  draft.status = out ? 'MATCH_END' : 'HAND_END';
  draft.stateVersion += 1;

  if (out) {
    log(draft, null, 'MATCH_ENDED', `${teamName(draft, out)} reached ${rules.kotTarget} Kot and lose the match.`);
  }

  events.push({ type: 'HAND_ENDED', payload: { result } });
  return { ok: true, state: draft, events };
}

/**
 * A member of the given team. Deterministic rather than random so that a hand
 * replays identically; the rulebook allows either.
 */
function pickFrom(state: MindiState, teamId: TeamId): string {
  const members = byPosition(state).filter((p) => p.teamId === teamId);
  const index = state.handNumber % members.length;
  return members[index]!.id;
}

export function startNextHand(state: MindiState, rules: MindiRules, rng: Rng): MindiState {
  return dealHand(state, rules, rng);
}

export function setTeamName(state: MindiState, teamId: TeamId, name: string): MindiState {
  const draft = draftOf(state);
  draft.teams[teamId].name = name.trim().slice(0, 20) || DEFAULT_TEAM_NAMES[teamId];
  draft.stateVersion += 1;
  return draft;
}

/** Every card in play, wherever it currently sits. Used by the tests. */
export function allCards(state: MindiState): Card[] {
  return [
    ...state.players.flatMap((p) => p.hand),
    ...state.currentTrick.plays.map((p) => p.card),
    ...state.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
    ...(state.hiddenCard ? [state.hiddenCard] : []),
  ];
}
