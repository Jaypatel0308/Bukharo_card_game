import { DEFAULT_TEAM_NAMES, cardLabel, createDeck } from './cards.js';
import {
  assignmentsOf,
  selectResolution,
  validateMeld,
  validateOpeningRun,
  type MeldResolution,
} from './meld.js';
import { shuffle, type Rng } from './random.js';
import { TEAM_IDS, buildRoundScoreRecord, determineWinner } from './scoring.js';
import type { RuleConfig } from './rules.js';
import type {
  Card,
  EngineError,
  EngineErrorCode,
  EngineEvent,
  EngineResult,
  GameAction,
  GamePlayer,
  GameState,
  Meld,
  NaturalRank,
  RoundScoreRecord,
  Seat,
  TeamId,
} from './types.js';

/** §4 — play runs clockwise. */
export const SEAT_ORDER: Seat[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

export const SEAT_TEAMS: Record<Seat, TeamId> = {
  NORTH: 'TEAM_A',
  EAST: 'TEAM_B',
  SOUTH: 'TEAM_A',
  WEST: 'TEAM_B',
};

export interface SeatAssignment {
  id: string;
  displayName: string;
  seat: Seat;
}

function fail(code: EngineErrorCode, message: string, options?: EngineError['options']): EngineError {
  return options ? { ok: false, code, message, options } : { ok: false, code, message };
}

/** Copy-on-write draft. Card objects are immutable and safely shared. */
function draftOf(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    teams: {
      TEAM_A: { ...state.teams.TEAM_A, playerIds: [...state.teams.TEAM_A.playerIds] },
      TEAM_B: { ...state.teams.TEAM_B, playerIds: [...state.teams.TEAM_B.playerIds] },
    },
    stock: [...state.stock],
    discardPile: [...state.discardPile],
    bucharoo: [...state.bucharoo],
    melds: state.melds.map((m) => ({ ...m, cards: [...m.cards] })),
    scoreHistory: [...state.scoreHistory],
    log: [...state.log],
  };
}

function nextSeq(draft: GameState): number {
  draft.seqCounter += 1;
  return draft.seqCounter;
}

function log(
  draft: GameState,
  playerId: string | null,
  type: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const entry = {
    seq: nextSeq(draft),
    roundNumber: draft.roundNumber,
    timestamp: draft.log.length, // replaced with a wall clock by the server layer
    playerId,
    type,
    message,
    ...(meta ? { meta } : {}),
  };
  draft.log.push(entry);
}

export function playerById(state: GameState, playerId: string): GamePlayer | undefined {
  return state.players.find((p) => p.id === playerId);
}

function nextPlayerId(state: GameState, playerId: string): string {
  const player = playerById(state, playerId)!;
  const index = SEAT_ORDER.indexOf(player.seat);
  for (let step = 1; step <= SEAT_ORDER.length; step++) {
    const seat = SEAT_ORDER[(index + step) % SEAT_ORDER.length]!;
    const candidate = state.players.find((p) => p.seat === seat);
    if (candidate) return candidate.id;
  }
  return playerId;
}

/* ------------------------------------------------------------------ */
/* Match & round setup                                                 */
/* ------------------------------------------------------------------ */

export interface CreateMatchOptions {
  roomId: string;
  seats: SeatAssignment[];
  targetScore: number;
  rules: RuleConfig;
  rng: Rng;
  /** Optional display names; the rooms layer lets the host set these. */
  teamNames?: Partial<Record<TeamId, string>>;
}

export function createMatch(options: CreateMatchOptions): GameState {
  const { roomId, seats, targetScore, rules, rng, teamNames } = options;
  if (seats.length !== 4) throw new Error('Bukharo requires exactly 4 seated players.');

  const players: GamePlayer[] = seats.map((seat) => ({
    id: seat.id,
    displayName: seat.displayName,
    seat: seat.seat,
    teamId: SEAT_TEAMS[seat.seat],
    hand: [],
    handType: 'ORIGINAL',
  }));

  const dealerSeat = SEAT_ORDER[rng.nextInt(SEAT_ORDER.length)]!;
  const dealer = players.find((p) => p.seat === dealerSeat)!;

  const base: GameState = {
    roomId,
    status: 'DEALING',
    roundNumber: 0,
    targetScore,
    players,
    teams: {
      TEAM_A: {
        id: 'TEAM_A',
        name: teamNames?.TEAM_A?.trim() || DEFAULT_TEAM_NAMES.TEAM_A,
        playerIds: players.filter((p) => p.teamId === 'TEAM_A').map((p) => p.id),
        isOpened: false,
        matchScore: 0,
        tookBucharoo: false,
        wentOut: false,
      },
      TEAM_B: {
        id: 'TEAM_B',
        name: teamNames?.TEAM_B?.trim() || DEFAULT_TEAM_NAMES.TEAM_B,
        playerIds: players.filter((p) => p.teamId === 'TEAM_B').map((p) => p.id),
        isOpened: false,
        matchScore: 0,
        tookBucharoo: false,
        wentOut: false,
      },
    },
    dealerPlayerId: dealer.id,
    currentPlayerId: dealer.id,
    turnPhase: 'AWAITING_DRAW',
    hasDrawnThisTurn: false,
    turnCounter: 0,
    stockEmptiedAtTurn: null,
    stock: [],
    discardPile: [],
    bucharoo: [],
    wildCard: null,
    wildRank: null,
    melds: [],
    bucharooTaken: false,
    bucharooTakenByTeamId: null,
    bucharooTakenByPlayerId: null,
    scoreHistory: [],
    winningTeamId: null,
    log: [],
    stateVersion: 0,
    seqCounter: 0,
  };

  return startRound(base, rules, rng);
}

/**
 * §7/§9/§86 — shuffle, deal 13 each, build the 13-card Bucharoo, reveal the
 * mid-stock card that fixes the wild rank, then turn the first discard.
 */
export function startRound(state: GameState, rules: RuleConfig, rng: Rng): GameState {
  const draft = draftOf(state);
  draft.roundNumber += 1;
  draft.status = 'DEALING';

  let deck = shuffle(createDeck(), rng);

  for (const player of draft.players) {
    player.hand = [];
    player.handType = 'ORIGINAL';
  }

  // Deal clockwise starting to the dealer's left.
  const order: GamePlayer[] = [];
  let cursor = nextPlayerId(draft, draft.dealerPlayerId);
  for (let i = 0; i < draft.players.length; i++) {
    order.push(playerById(draft, cursor)!);
    cursor = nextPlayerId(draft, cursor);
  }
  for (let round = 0; round < rules.cardsPerPlayer; round++) {
    for (const player of order) {
      player.hand.push(deck.pop()!);
    }
  }

  draft.bucharoo = deck.splice(deck.length - rules.bucharooSize, rules.bucharooSize);
  draft.stock = deck;
  draft.discardPile = [];

  // Wild reveal from the middle of the stock.
  draft.wildCard = null;
  draft.wildRank = null;
  if (rules.roundWildEnabled) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const index = Math.floor(draft.stock.length / 2);
      const revealed = draft.stock[index]!;
      if (revealed.isJoker && rules.jokerWildRevealPolicy === 'REDRAW') {
        draft.stock = shuffle(draft.stock, rng);
        continue;
      }
      draft.stock.splice(index, 1);
      draft.wildCard = revealed;
      draft.wildRank = revealed.isJoker ? 'A' : (revealed.rank as NaturalRank);
      if (!rules.wildCardSetAside) draft.discardPile.push(revealed);
      break;
    }
  }

  draft.melds = [];
  draft.teams.TEAM_A.isOpened = false;
  draft.teams.TEAM_B.isOpened = false;
  draft.teams.TEAM_A.tookBucharoo = false;
  draft.teams.TEAM_B.tookBucharoo = false;
  draft.teams.TEAM_A.wentOut = false;
  draft.teams.TEAM_B.wentOut = false;
  draft.bucharooTaken = false;
  draft.bucharooTakenByTeamId = null;
  draft.bucharooTakenByPlayerId = null;

  // First discard turns the top of the stock face up.
  if (draft.stock.length > 0) draft.discardPile.push(draft.stock.pop()!);

  draft.currentPlayerId = nextPlayerId(draft, draft.dealerPlayerId);
  draft.turnPhase = 'AWAITING_DRAW';
  draft.hasDrawnThisTurn = false;
  draft.turnCounter = 0;
  draft.stockEmptiedAtTurn = null;
  draft.status = 'PLAYING';
  draft.stateVersion += 1;

  log(draft, null, 'ROUND_STARTED', `Round ${draft.roundNumber} started. Wild rank: ${draft.wildRank ?? 'none'}.`, {
    roundNumber: draft.roundNumber,
    wildRank: draft.wildRank,
  });
  return draft;
}

export function startNextRound(state: GameState, rules: RuleConfig, rng: Rng): GameState {
  const rotated = draftOf(state);
  rotated.dealerPlayerId = nextPlayerId(rotated, rotated.dealerPlayerId);
  return startRound(rotated, rules, rng);
}

/* ------------------------------------------------------------------ */
/* Turn helpers                                                        */
/* ------------------------------------------------------------------ */

function refreshPhase(draft: GameState): void {
  const player = playerById(draft, draft.currentPlayerId)!;
  if (!draft.hasDrawnThisTurn) {
    draft.turnPhase = 'AWAITING_DRAW';
    return;
  }
  draft.turnPhase = player.hand.length === 1 ? 'AWAITING_DISCARD' : 'PLAYING_CARDS';
}

function advanceTurn(draft: GameState): void {
  draft.currentPlayerId = nextPlayerId(draft, draft.currentPlayerId);
  draft.hasDrawnThisTurn = false;
  draft.turnPhase = 'AWAITING_DRAW';
  draft.turnCounter += 1;
}

/** Starts (or reads) the countdown that follows an exhausted stock (§84). */
function noteStockLevel(draft: GameState): void {
  if (draft.stock.length === 0) {
    if (draft.stockEmptiedAtTurn === null) draft.stockEmptiedAtTurn = draft.turnCounter;
  } else {
    draft.stockEmptiedAtTurn = null;
  }
}

/**
 * Decides whether the round can still continue without a stock. Returns the
 * finished state when it cannot.
 *
 * Once the stock is gone the discard pile never truly empties — the player who
 * takes it must put one card back — so play would loop forever if nobody can go
 * out. `rules.lapsAfterStockExhausted` bounds that tail.
 */
function stockExhaustionOutcome(
  state: GameState,
  rules: RuleConfig,
  playerId: string,
): EngineResult | null {
  if (state.stock.length > 0) return null;

  const endNow = (): EngineResult => ({
    ok: true,
    state: endRound(state, rules, 'NO_DRAW_SOURCE', playerId),
    events: [{ type: 'ROUND_ENDED', payload: { reason: 'NO_DRAW_SOURCE' } }],
  });

  if (rules.stockExhaustionRule === 'END_ROUND_IMMEDIATELY') return endNow();
  if (state.discardPile.length === 0) return endNow();

  const since = state.stockEmptiedAtTurn;
  if (since !== null && state.turnCounter - since >= rules.lapsAfterStockExhausted * state.players.length) {
    return endNow();
  }
  return null;
}

function guardTurn(
  state: GameState,
  playerId: string,
  phases: GameState['turnPhase'][],
): EngineError | null {
  if (state.status !== 'PLAYING') {
    return fail('GAME_NOT_PLAYING', 'The round is not in progress.');
  }
  if (state.currentPlayerId !== playerId) {
    return fail('NOT_YOUR_TURN', 'It is not your turn.');
  }
  if (!phases.includes(state.turnPhase)) {
    if (state.turnPhase === 'AWAITING_DRAW') {
      return fail('MUST_DRAW_FIRST', 'You must draw a card or take the discard pile first.');
    }
    return fail('WRONG_PHASE', 'You cannot do that right now.');
  }
  return null;
}

/** A clearer message than "wrong phase" for the commonest mistake. */
function guardAlreadyDrew(state: GameState, playerId: string): EngineError | null {
  if (state.status === 'PLAYING' && state.currentPlayerId === playerId && state.hasDrawnThisTurn) {
    return fail('ALREADY_DREW', 'You have already drawn this turn.');
  }
  return null;
}

function takeFromHand(player: GamePlayer, cardIds: string[]): { ok: true; cards: Card[] } | EngineError {
  const unique = new Set(cardIds);
  if (unique.size !== cardIds.length) {
    return fail('DUPLICATE_CARDS', 'The same card was selected more than once.');
  }
  const cards: Card[] = [];
  for (const id of cardIds) {
    const card = player.hand.find((c) => c.id === id);
    if (!card) {
      return fail('CARD_NOT_IN_HAND', 'You tried to play a card that is not in your hand.');
    }
    cards.push(card);
  }
  return { ok: true, cards };
}

/** §25 — an emptied original hand collects the Bucharoo. */
function tryTakeBucharoo(draft: GameState, player: GamePlayer, rules: RuleConfig, events: EngineEvent[]): boolean {
  if (player.hand.length !== 0) return false;
  if (player.handType !== 'ORIGINAL') return false;
  if (draft.bucharooTaken || draft.bucharoo.length === 0) return false;

  player.hand = draft.bucharoo;
  player.handType = 'BUCHAROO';
  draft.bucharoo = [];
  draft.bucharooTaken = true;
  draft.bucharooTakenByTeamId = player.teamId;
  draft.bucharooTakenByPlayerId = player.id;
  draft.teams[player.teamId].tookBucharoo = true;

  log(
    draft,
    player.id,
    'BUCHAROO_TAKEN',
    `${player.displayName} took the Bucharoo (+${rules.bucharooBonus} for ${teamLabel(draft, player.teamId)}).`,
    { teamId: player.teamId },
  );
  events.push({
    type: 'BUCHAROO_TAKEN',
    payload: { playerId: player.id, teamId: player.teamId, bonus: rules.bucharooBonus },
  });
  events.push({
    type: 'BUCHAROO_HAND',
    privateToPlayerId: player.id,
    payload: { cards: player.hand },
  });
  return true;
}

function teamLabel(state: GameState, teamId: TeamId): string {
  return state.teams[teamId].name || DEFAULT_TEAM_NAMES[teamId];
}

/** Renames a team. Purely cosmetic, so it does not bump the rules anywhere. */
export function setTeamName(state: GameState, teamId: TeamId, name: string): GameState {
  const draft = draftOf(state);
  draft.teams[teamId].name = name.trim().slice(0, 20) || DEFAULT_TEAM_NAMES[teamId];
  draft.stateVersion += 1;
  return draft;
}

/** Could this player legally end the round right now? */
function canGoOut(state: GameState, player: GamePlayer, rules: RuleConfig): { ok: boolean; reason: string } {
  if (rules.bucharooMustBeTakenBeforeGoingOut && !state.bucharooTaken) {
    return { ok: false, reason: 'The Bucharoo must be taken before anyone can go out.' };
  }
  if (rules.requireBucharoBeforeGoingOut) {
    const hasBucharo = state.melds.some((m) => m.teamId === player.teamId && m.isBucharo);
    if (!hasBucharo) {
      return { ok: false, reason: 'Your team must complete a Bucharo of 7 cards before going out.' };
    }
  }
  return { ok: true, reason: '' };
}

/* ------------------------------------------------------------------ */
/* Round end                                                           */
/* ------------------------------------------------------------------ */

export function endRound(
  state: GameState,
  rules: RuleConfig,
  endedBy: RoundScoreRecord['endedBy'],
  endedByPlayerId: string | null,
): GameState {
  const draft = draftOf(state);
  const record = buildRoundScoreRecord(draft, rules, endedBy, endedByPlayerId);
  draft.scoreHistory.push(record);
  for (const teamId of TEAM_IDS) {
    draft.teams[teamId].matchScore = record.teams[teamId].matchTotalAfter;
  }

  const winner = determineWinner(
    { TEAM_A: draft.teams.TEAM_A.matchScore, TEAM_B: draft.teams.TEAM_B.matchScore },
    draft.targetScore,
  );
  draft.winningTeamId = winner;
  draft.status = winner ? 'MATCH_END' : 'ROUND_END';
  draft.turnPhase = 'TURN_COMPLETE';
  draft.stateVersion += 1;

  log(
    draft,
    endedByPlayerId,
    'ROUND_ENDED',
    `Round ${draft.roundNumber} ended. Team A ${record.teams.TEAM_A.roundTotal}, Team B ${record.teams.TEAM_B.roundTotal}.`,
    { endedBy },
  );
  if (winner) {
    log(draft, null, 'MATCH_ENDED', `${teamLabel(draft, winner)} wins the match.`, { winner });
  }
  return draft;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function applyAction(
  state: GameState,
  action: GameAction,
  rules: RuleConfig,
): EngineResult {
  switch (action.type) {
    case 'DRAW_STOCK':
      return drawStock(state, action.playerId, rules);
    case 'TAKE_DISCARD_PILE':
      return takeDiscardPile(state, action.playerId, rules);
    case 'CREATE_MELD':
      return createMeld(state, action, rules);
    case 'ADD_TO_MELD':
      return addToMeld(state, action, rules);
    case 'DISCARD':
      return discardCard(state, action, rules);
    default:
      return fail('INVALID_MELD', 'Unknown action.');
  }
}

function drawStock(state: GameState, playerId: string, rules: RuleConfig): EngineResult {
  const drawn = guardAlreadyDrew(state, playerId);
  if (drawn) return drawn;
  const guard = guardTurn(state, playerId, ['AWAITING_DRAW']);
  if (guard) return guard;

  const exhausted = stockExhaustionOutcome(state, rules, playerId);
  if (exhausted) return exhausted;
  if (state.stock.length === 0) {
    return fail('EMPTY_STOCK', 'The stock is empty. You must take the discard pile instead.');
  }

  const draft = draftOf(state);
  const player = playerById(draft, playerId)!;
  const card = draft.stock.pop()!;
  player.hand.push(card);
  draft.hasDrawnThisTurn = true;
  noteStockLevel(draft);
  refreshPhase(draft);
  draft.stateVersion += 1;

  log(draft, playerId, 'DREW_FROM_STOCK', `${player.displayName} drew from the stock.`);

  return {
    ok: true,
    state: draft,
    events: [
      { type: 'CARD_DRAWN', privateToPlayerId: playerId, payload: { card } },
      {
        type: 'PLAYER_DREW_CARD',
        payload: { playerId, handCount: player.hand.length, stockCount: draft.stock.length },
      },
    ],
  };
}

/** §20 — the whole pile, any time, no qualification. */
function takeDiscardPile(state: GameState, playerId: string, rules: RuleConfig): EngineResult {
  const drawn = guardAlreadyDrew(state, playerId);
  if (drawn) return drawn;
  const guard = guardTurn(state, playerId, ['AWAITING_DRAW']);
  if (guard) return guard;

  const exhausted = stockExhaustionOutcome(state, rules, playerId);
  if (exhausted) return exhausted;
  if (state.discardPile.length === 0) {
    return fail('EMPTY_DISCARD_PILE', 'The discard pile is empty, so you must draw from the stock.');
  }

  const draft = draftOf(state);
  const player = playerById(draft, playerId)!;
  const taken = draft.discardPile;
  const count = taken.length;
  player.hand.push(...(rules.discardPickupTakesEntirePile ? taken : [taken[taken.length - 1]!]));
  draft.discardPile = rules.discardPickupTakesEntirePile ? [] : taken.slice(0, -1);
  draft.hasDrawnThisTurn = true;
  noteStockLevel(draft);
  refreshPhase(draft);
  draft.stateVersion += 1;

  log(
    draft,
    playerId,
    'TOOK_DISCARD_PILE',
    `${player.displayName} took ${count} card${count === 1 ? '' : 's'} from the discard pile.`,
    { count },
  );

  return {
    ok: true,
    state: draft,
    events: [
      { type: 'DISCARD_PILE_TAKEN', payload: { playerId, count, handCount: player.hand.length } },
    ],
  };
}

/** Guards §27: a player may never meld away the card they need to discard. */
function guardMeldWouldStrandPlayer(
  state: GameState,
  player: GamePlayer,
  cardsUsed: number,
  rules: RuleConfig,
): EngineError | null {
  const remaining = player.hand.length - cardsUsed;
  if (remaining > 0) return null;

  const bucharooAvailable =
    player.handType === 'ORIGINAL' && !state.bucharooTaken && state.bucharoo.length > 0;
  if (bucharooAvailable && rules.bucharooPickupTiming === 'IMMEDIATE') return null;

  return fail('MUST_KEEP_DISCARD', 'You must keep one card to discard in order to go out.');
}

function applyBucharoStatus(meld: Meld, rules: RuleConfig): void {
  const reachedBucharo = meld.cards.length >= rules.bucharoMinimumCards;
  if (!reachedBucharo) {
    meld.isBucharo = false;
    return;
  }
  const newlyQualified = !meld.isBucharo;
  meld.isBucharo = true;
  if (newlyQualified || !rules.lockBucharoBonusOnCompletion) {
    meld.bucharoBonusAwarded = meld.isClean ? 'CLEAN' : 'DIRTY';
  }
}

function createMeld(
  state: GameState,
  action: Extract<GameAction, { type: 'CREATE_MELD' }>,
  rules: RuleConfig,
): EngineResult {
  const guard = guardTurn(state, action.playerId, ['PLAYING_CARDS']);
  if (guard) return guard;

  const player = playerById(state, action.playerId)!;
  const taken = takeFromHand(player, action.cardIds);
  if (!taken.ok) return taken;
  const cards = taken.cards;

  const teamOpened = state.teams[player.teamId].isOpened;
  const ctx = { wildRank: state.wildRank, rules };
  const validation = teamOpened
    ? validateMeld(cards, ctx, action.meldType)
    : validateOpeningRun(cards, ctx);

  if (!validation.ok) return fail(validation.code, validation.message);

  const selected = selectResolution(validation.resolutions, action.wildAssignments);
  if (!selected.ok) {
    return fail(
      'AMBIGUOUS_WILD',
      'Choose what your wild card should represent.',
      selected.options.map(assignmentsOf),
    );
  }
  const resolution: MeldResolution = selected.resolution;

  const stranded = guardMeldWouldStrandPlayer(state, player, cards.length, rules);
  if (stranded) return stranded;

  const draft = draftOf(state);
  const draftPlayer = playerById(draft, action.playerId)!;
  const usedIds = new Set(cards.map((c) => c.id));
  draftPlayer.hand = draftPlayer.hand.filter((c) => !usedIds.has(c.id));

  const meld: Meld = {
    id: `meld_${nextSeq(draft)}`,
    teamId: draftPlayer.teamId,
    type: resolution.type,
    cards: resolution.cards,
    isClean: resolution.isClean,
    isBucharo: false,
    bucharoBonusAwarded: 'NONE',
    createdByPlayerId: draftPlayer.id,
    isOpeningMeld: !teamOpened,
  };
  applyBucharoStatus(meld, rules);
  draft.melds.push(meld);

  const events: EngineEvent[] = [];

  if (!teamOpened) {
    draft.teams[draftPlayer.teamId].isOpened = true;
    log(
      draft,
      draftPlayer.id,
      'TEAM_OPENED',
      `${draftPlayer.displayName} laid the opening run. ${teamLabel(draft, draftPlayer.teamId)} is now open.`,
      { teamId: draftPlayer.teamId },
    );
    events.push({ type: 'TEAM_OPENED', payload: { teamId: draftPlayer.teamId, playerId: draftPlayer.id } });
  }

  log(
    draft,
    draftPlayer.id,
    'MELD_CREATED',
    `${draftPlayer.displayName} created a ${meld.isClean ? 'clean' : 'dirty'} ${meld.type.toLowerCase()} of ${meld.cards.length} cards.`,
    { meldId: meld.id, teamId: meld.teamId },
  );
  events.push({ type: 'MELD_CREATED', payload: { meld } });

  if (meld.isBucharo) {
    log(
      draft,
      draftPlayer.id,
      'BUCHARO_COMPLETED',
      `${teamLabel(draft, meld.teamId)} completed a ${meld.bucharoBonusAwarded === 'CLEAN' ? 'clean' : 'dirty'} Bucharo.`,
      { meldId: meld.id },
    );
    events.push({ type: 'BUCHARO_COMPLETED', payload: { meldId: meld.id, kind: meld.bucharoBonusAwarded } });
  }

  tryTakeBucharoo(draft, draftPlayer, rules, events);
  refreshPhase(draft);
  draft.stateVersion += 1;
  return { ok: true, state: draft, events };
}

function addToMeld(
  state: GameState,
  action: Extract<GameAction, { type: 'ADD_TO_MELD' }>,
  rules: RuleConfig,
): EngineResult {
  const guard = guardTurn(state, action.playerId, ['PLAYING_CARDS']);
  if (guard) return guard;

  const player = playerById(state, action.playerId)!;
  const meld = state.melds.find((m) => m.id === action.meldId);
  if (!meld) return fail('MELD_NOT_FOUND', 'That meld no longer exists.');
  if (meld.teamId !== player.teamId) {
    return fail('MELD_WRONG_TEAM', 'You can only add cards to your own team’s melds.');
  }
  if (!state.teams[player.teamId].isOpened) {
    return fail(
      'TEAM_NOT_OPENED',
      `Your team must first open with a clean run of at least ${rules.openingRunMinimum} cards.`,
    );
  }

  const taken = takeFromHand(player, action.cardIds);
  if (!taken.ok) return taken;
  const newCards = taken.cards;
  if (newCards.length === 0) return fail('INVALID_MELD', 'Select at least one card to add.');

  const combined = [...meld.cards.map((c) => c.card), ...newCards];
  const validation = validateMeld(combined, { wildRank: state.wildRank, rules }, meld.type);
  if (!validation.ok) {
    return fail(
      validation.code,
      `These cards cannot be added to that ${meld.type.toLowerCase()}. ${validation.message}`,
    );
  }

  const selected = selectResolution(validation.resolutions, action.wildAssignments);
  if (!selected.ok) {
    return fail(
      'AMBIGUOUS_WILD',
      'Choose what your wild card should represent.',
      selected.options.map(assignmentsOf),
    );
  }

  const stranded = guardMeldWouldStrandPlayer(state, player, newCards.length, rules);
  if (stranded) return stranded;

  const draft = draftOf(state);
  const draftPlayer = playerById(draft, action.playerId)!;
  const draftMeld = draft.melds.find((m) => m.id === action.meldId)!;
  const usedIds = new Set(newCards.map((c) => c.id));
  draftPlayer.hand = draftPlayer.hand.filter((c) => !usedIds.has(c.id));

  const wasBucharo = draftMeld.isBucharo;
  draftMeld.cards = selected.resolution.cards;
  draftMeld.isClean = selected.resolution.isClean;
  applyBucharoStatus(draftMeld, rules);

  const events: EngineEvent[] = [];
  log(
    draft,
    draftPlayer.id,
    'MELD_EXTENDED',
    `${draftPlayer.displayName} added ${newCards.length} card${newCards.length === 1 ? '' : 's'} to a team ${draftMeld.type.toLowerCase()}.`,
    { meldId: draftMeld.id, teamId: draftMeld.teamId },
  );
  events.push({ type: 'MELD_UPDATED', payload: { meld: draftMeld } });

  if (draftMeld.isBucharo && !wasBucharo) {
    log(
      draft,
      draftPlayer.id,
      'BUCHARO_COMPLETED',
      `${teamLabel(draft, draftMeld.teamId)} completed a ${draftMeld.bucharoBonusAwarded === 'CLEAN' ? 'clean' : 'dirty'} Bucharo.`,
      { meldId: draftMeld.id },
    );
    events.push({ type: 'BUCHARO_COMPLETED', payload: { meldId: draftMeld.id, kind: draftMeld.bucharoBonusAwarded } });
  }

  tryTakeBucharoo(draft, draftPlayer, rules, events);
  refreshPhase(draft);
  draft.stateVersion += 1;
  return { ok: true, state: draft, events };
}

function discardCard(
  state: GameState,
  action: Extract<GameAction, { type: 'DISCARD' }>,
  rules: RuleConfig,
): EngineResult {
  const guard = guardTurn(state, action.playerId, ['PLAYING_CARDS', 'AWAITING_DISCARD']);
  if (guard) return guard;

  const player = playerById(state, action.playerId)!;
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card) return fail('CARD_NOT_IN_HAND', 'That card is not in your hand.');

  // Discarding the last card either collects the Bucharoo or goes out.
  const emptiesHand = player.hand.length === 1;
  const willTakeBucharoo =
    emptiesHand && player.handType === 'ORIGINAL' && !state.bucharooTaken && state.bucharoo.length > 0;

  if (emptiesHand && !willTakeBucharoo) {
    const goOut = canGoOut(state, player, rules);
    if (!goOut.ok) return fail('CANNOT_GO_OUT_YET', goOut.reason);
  }

  const draft = draftOf(state);
  const draftPlayer = playerById(draft, action.playerId)!;
  draftPlayer.hand = draftPlayer.hand.filter((c) => c.id !== action.cardId);
  draft.discardPile.push(card);

  const events: EngineEvent[] = [];
  // The discard is face up, so naming it in the log is public information —
  // but the raw id is not repeated in `meta`, which downstream code treats as
  // machine-readable state.
  log(draft, draftPlayer.id, 'DISCARDED', `${draftPlayer.displayName} discarded ${cardLabel(card)}.`);

  const tookBucharoo = tryTakeBucharoo(draft, draftPlayer, rules, events);

  if (draftPlayer.hand.length === 0 && !tookBucharoo) {
    draft.teams[draftPlayer.teamId].wentOut = true;
    log(
      draft,
      draftPlayer.id,
      'WENT_OUT',
      `${draftPlayer.displayName} went out (+${rules.goingOutBonus} for ${teamLabel(draft, draftPlayer.teamId)}).`,
      { teamId: draftPlayer.teamId },
    );
    events.push({ type: 'PLAYER_WENT_OUT', payload: { playerId: draftPlayer.id, teamId: draftPlayer.teamId } });
    const ended = endRound(draft, rules, 'WENT_OUT', draftPlayer.id);
    return { ok: true, state: ended, events };
  }

  if (tookBucharoo && rules.bucharooPickupContinuesTurn) {
    // The turn carries on with the new hand; another discard will end it.
    refreshPhase(draft);
    draft.stateVersion += 1;
    events.push({
      type: 'CARD_DISCARDED',
      payload: {
        playerId: draftPlayer.id,
        card,
        handCount: draftPlayer.hand.length,
        nextPlayerId: draft.currentPlayerId,
      },
    });
    return { ok: true, state: draft, events };
  }

  advanceTurn(draft);
  draft.stateVersion += 1;
  events.push({
    type: 'CARD_DISCARDED',
    payload: {
      playerId: draftPlayer.id,
      card,
      handCount: draftPlayer.hand.length,
      nextPlayerId: draft.currentPlayerId,
    },
  });
  return { ok: true, state: draft, events };
}
