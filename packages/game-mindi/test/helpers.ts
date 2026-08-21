import { buildDeck } from '../src/cards.js';
import { applyMindiAction, createMindiMatch } from '../src/engine.js';
import { seededRng } from '../src/random.js';
import { withMindiRules, type MindiRules } from '../src/rules.js';
import type { Card, MindiAction, MindiState, Rank, Suit } from '../src/types.js';

const DECK = [...buildDeck(8)];

export function card(rank: Rank, suit: Suit, deckNumber: 1 | 2 = 1): Card {
  const found = DECK.find(
    (c) => c.rank === rank && c.suit === suit && c.deckNumber === deckNumber,
  );
  if (!found) throw new Error(`no such card: ${rank} of ${suit} (deck ${deckNumber})`);
  return found;
}

export function rules(overrides: Partial<MindiRules> = {}): MindiRules {
  return withMindiRules(overrides);
}

export function seatsFor(count: number) {
  const names = ['Rahul', 'Maya', 'Priya', 'Sam', 'Nina', 'Omar', 'Zara', 'Kabir'];
  return Array.from({ length: count }, (_, position) => ({
    id: `p${position + 1}`,
    displayName: names[position]!,
    position,
  }));
}

export function newMatch(playerCount = 4, seed = 42, overrides: Partial<MindiRules> = {}): MindiState {
  return createMindiMatch({
    roomId: 'room_test',
    seats: seatsFor(playerCount),
    rules: rules(overrides),
    rng: seededRng(seed),
    teamNames: { TEAM_A: 'Rockets', TEAM_B: 'Comets' },
  });
}

/**
 * Test scaffolding: forces hands and trump state so a situation can be set up
 * directly rather than played into over a dozen tricks.
 */
export function scenario(
  state: MindiState,
  setup: {
    hands?: Record<string, Card[]>;
    currentPlayerId?: string;
    mode?: MindiState['mode'];
    trumpSuit?: Suit | null;
    trumpActive?: boolean;
    hiddenCard?: Card | null;
    hiddenRevealed?: boolean;
    chooserId?: string;
    status?: MindiState['status'];
  },
): MindiState {
  const next: MindiState = {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    teams: { TEAM_A: { ...state.teams.TEAM_A }, TEAM_B: { ...state.teams.TEAM_B } },
    currentTrick: { ...state.currentTrick, plays: [...state.currentTrick.plays] },
    completedTricks: [...state.completedTricks],
    log: [...state.log],
  };
  if (setup.hands) {
    for (const [playerId, hand] of Object.entries(setup.hands)) {
      const player = next.players.find((p) => p.id === playerId);
      if (!player) throw new Error(`unknown player ${playerId}`);
      player.hand = [...hand];
    }
  }
  if (setup.currentPlayerId) next.currentPlayerId = setup.currentPlayerId;
  if (setup.mode !== undefined) next.mode = setup.mode;
  if (setup.trumpSuit !== undefined) next.trumpSuit = setup.trumpSuit;
  if (setup.trumpActive !== undefined) next.trumpActive = setup.trumpActive;
  if (setup.hiddenCard !== undefined) next.hiddenCard = setup.hiddenCard;
  if (setup.hiddenRevealed !== undefined) next.hiddenRevealed = setup.hiddenRevealed;
  if (setup.chooserId) next.chooserId = setup.chooserId;
  if (setup.status) next.status = setup.status;
  return next;
}

/** Plays a whole trick in seating order, returning the resulting state. */
export function playTrick(
  state: MindiState,
  plays: Array<[playerId: string, card: Card]>,
  ruleset: MindiRules = rules(),
): MindiState {
  let current = state;
  for (const [playerId, chosen] of plays) {
    const result = applyOrThrow(current, { type: 'PLAY_CARD', playerId, cardId: chosen.id }, ruleset);
    current = result;
  }
  return current;
}

export function applyOrThrow(
  state: MindiState,
  action: MindiAction,
  ruleset: MindiRules = rules(),
): MindiState {
  const result = applyMindiAction(state, action, ruleset, seededRng(1));
  if (!result.ok) throw new Error(`${action.type} refused: ${result.code} — ${result.message}`);
  return result.state;
}
