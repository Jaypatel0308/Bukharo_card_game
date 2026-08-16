import { createDeck } from '../src/cards.js';
import type { Card, GameState, NaturalRank, Suit } from '../src/types.js';
import { DEFAULT_RULES, type RuleConfig } from '../src/rules.js';
import { createMatch, SEAT_ORDER } from '../src/engine.js';
import { seededRng } from '../src/random.js';

const DECK = createDeck();

/** Fetch a specific physical card, e.g. `card('7', 'hearts')` or `card('7','hearts',2)`. */
export function card(rank: NaturalRank, suit: Suit, deckNumber: 1 | 2 = 1): Card {
  const found = DECK.find((c) => c.rank === rank && c.suit === suit && c.deckNumber === deckNumber);
  if (!found) throw new Error(`No such card: ${rank} ${suit} deck ${deckNumber}`);
  return found;
}

export function joker(n: 1 | 2 = 1, deckNumber: 1 | 2 = 1): Card {
  const found = DECK.find((c) => c.isJoker && c.deckNumber === deckNumber && c.id.endsWith(String(n)));
  if (!found) throw new Error('No such joker');
  return found;
}

export function rules(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return { ...DEFAULT_RULES, ...overrides };
}

export const SEATS = [
  { id: 'p1', displayName: 'Rahul', seat: SEAT_ORDER[0]! },
  { id: 'p2', displayName: 'Maya', seat: SEAT_ORDER[1]! },
  { id: 'p3', displayName: 'Priya', seat: SEAT_ORDER[2]! },
  { id: 'p4', displayName: 'Sam', seat: SEAT_ORDER[3]! },
];

export function newGame(overrides: Partial<RuleConfig> = {}, seed = 42): GameState {
  return createMatch({
    roomId: 'room_test',
    seats: SEATS,
    targetScore: overrides.targetScore ?? 2000,
    rules: rules(overrides),
    rng: seededRng(seed),
  });
}

/**
 * Test scaffolding: force a player's hand and turn state so a scenario can be
 * set up directly rather than played out over dozens of turns.
 */
export function scenario(
  state: GameState,
  setup: {
    currentPlayerId?: string;
    hands?: Record<string, Card[]>;
    wildRank?: NaturalRank | null;
    turnPhase?: GameState['turnPhase'];
    hasDrawn?: boolean;
    stock?: Card[];
    discardPile?: Card[];
    bucharoo?: Card[];
    opened?: Partial<Record<'TEAM_A' | 'TEAM_B', boolean>>;
  },
): GameState {
  const next: GameState = {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    teams: { TEAM_A: { ...state.teams.TEAM_A }, TEAM_B: { ...state.teams.TEAM_B } },
    melds: state.melds.map((m) => ({ ...m })),
    log: [...state.log],
  };
  if (setup.currentPlayerId) next.currentPlayerId = setup.currentPlayerId;
  if (setup.hands) {
    for (const [playerId, hand] of Object.entries(setup.hands)) {
      const player = next.players.find((p) => p.id === playerId);
      if (!player) throw new Error(`Unknown player ${playerId}`);
      player.hand = [...hand];
    }
  }
  if (setup.wildRank !== undefined) next.wildRank = setup.wildRank;
  if (setup.turnPhase) next.turnPhase = setup.turnPhase;
  if (setup.hasDrawn !== undefined) next.hasDrawnThisTurn = setup.hasDrawn;
  if (setup.stock) {
    next.stock = [...setup.stock];
    next.stockEmptiedAtTurn = next.stock.length === 0 ? next.turnCounter : null;
  }
  if (setup.discardPile) next.discardPile = [...setup.discardPile];
  if (setup.bucharoo) next.bucharoo = [...setup.bucharoo];
  if (setup.opened) {
    if (setup.opened.TEAM_A !== undefined) next.teams.TEAM_A.isOpened = setup.opened.TEAM_A;
    if (setup.opened.TEAM_B !== undefined) next.teams.TEAM_B.isOpened = setup.opened.TEAM_B;
  }
  return next;
}

/** A hand that has already drawn and is mid-play. */
export function playing(
  state: GameState,
  playerId: string,
  hand: Card[],
  extra: Parameters<typeof scenario>[1] = {},
): GameState {
  return scenario(state, {
    currentPlayerId: playerId,
    hands: { [playerId]: hand },
    turnPhase: hand.length === 1 ? 'AWAITING_DISCARD' : 'PLAYING_CARDS',
    hasDrawn: true,
    ...extra,
  });
}

export function ids(cards: Card[]): string[] {
  return cards.map((c) => c.id);
}
