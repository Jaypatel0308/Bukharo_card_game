import { describe, expect, it } from 'vitest';
import { DEFAULT_MINDI_RULES, createMindiMatch, seededRng, viewMindiFor } from '@bukharo/game-mindi';
import type { MindiState } from '@bukharo/game-mindi';
import type { MindiView } from '@bukharo/shared';

import { canRevealTrump, trickOnDisplay, trumpSummary, unplayableCardIds } from './rules';

const SEATS = ['Rahul', 'Maya', 'Priya', 'Sam'].map((displayName, position) => ({
  id: `p${position + 1}`,
  displayName,
  position,
}));

function match(): MindiState {
  return createMindiMatch({
    roomId: 'r',
    seats: SEATS,
    rules: DEFAULT_MINDI_RULES,
    rng: seededRng(11),
    teamNames: { TEAM_A: 'Rockets', TEAM_B: 'Comets' },
  });
}

/** A view with the bits under test dictated. */
function viewWith(overrides: Partial<MindiView>): MindiView {
  return { ...viewMindiFor(match(), 'p1'), status: 'PLAYING', ...overrides } as MindiView;
}

const card = (id: string, suit: MindiView['trumpSuit'], rank = '5') =>
  ({ id, rank, suit, deckNumber: 1 }) as never;

describe('which cards may be played', () => {
  it('offers nothing at all when it is not your turn', () => {
    const view = viewWith({ currentPlayerId: 'p2' });
    expect(unplayableCardIds(view)).toEqual(view.you!.hand.map((c) => c.id));
  });

  it('offers everything when you lead', () => {
    const view = viewWith({
      currentPlayerId: 'p1',
      currentTrick: { leadSuit: null, plays: [] },
    });
    expect(unplayableCardIds(view)).toEqual([]);
  });

  it('narrows to the suit led when you hold it', () => {
    const view = viewWith({
      currentPlayerId: 'p1',
      currentTrick: { leadSuit: 'hearts', plays: [] },
      you: {
        ...viewWith({}).you!,
        hand: [card('h1', 'hearts'), card('s1', 'spades'), card('h2', 'hearts')],
      },
    });
    expect(unplayableCardIds(view)).toEqual(['s1']);
  });

  it('offers everything once you are void', () => {
    const view = viewWith({
      currentPlayerId: 'p1',
      currentTrick: { leadSuit: 'hearts', plays: [] },
      you: { ...viewWith({}).you!, hand: [card('s1', 'spades'), card('c1', 'clubs')] },
    });
    expect(unplayableCardIds(view)).toEqual([]);
  });

  it('narrows to trump for whoever called for it', () => {
    const view = viewWith({
      currentPlayerId: 'p1',
      mustPlayTrumpBy: 'p1',
      trumpSuit: 'spades',
      currentTrick: { leadSuit: 'hearts', plays: [] },
      you: { ...viewWith({}).you!, hand: [card('s1', 'spades'), card('c1', 'clubs')] },
    });
    expect(unplayableCardIds(view)).toEqual(['c1']);
  });
});

describe('calling for the hidden trump', () => {
  const base = {
    currentPlayerId: 'p1',
    mode: 'HIDDEN' as const,
    hiddenRevealed: false,
    hiddenCardWaiting: true,
    chooserId: 'p2',
    currentTrick: { leadSuit: 'hearts' as const, plays: [] },
  };
  const voidHand = { hand: [card('s1', 'spades')] };

  it('is offered to a player who cannot follow', () => {
    const view = viewWith({ ...base, you: { ...viewWith({}).you!, ...voidHand } });
    expect(canRevealTrump(view)).toBe(true);
  });

  it('is not offered while you can still follow', () => {
    const view = viewWith({
      ...base,
      you: { ...viewWith({}).you!, hand: [card('h1', 'hearts')] },
    });
    expect(canRevealTrump(view)).toBe(false);
  });

  it('is never offered to the player who hid it', () => {
    const view = viewWith({ ...base, chooserId: 'p1', you: { ...viewWith({}).you!, ...voidHand } });
    expect(canRevealTrump(view)).toBe(false);
  });

  it('is not offered once it has been turned over', () => {
    const view = viewWith({
      ...base,
      hiddenRevealed: true,
      hiddenCardWaiting: false,
      you: { ...viewWith({}).you!, ...voidHand },
    });
    expect(canRevealTrump(view)).toBe(false);
  });

  it('is not offered in a Katte hand, where nothing is hidden', () => {
    const view = viewWith({
      ...base,
      mode: 'KATTE',
      hiddenCardWaiting: false,
      you: { ...viewWith({}).you!, ...voidHand },
    });
    expect(canRevealTrump(view)).toBe(false);
  });

  it('is not offered before anyone has led', () => {
    const view = viewWith({
      ...base,
      currentTrick: { leadSuit: null, plays: [] },
      you: { ...viewWith({}).you!, ...voidHand },
    });
    expect(canRevealTrump(view)).toBe(false);
  });
});

describe('what the table says about trump', () => {
  it('describes each state in words a player can act on', () => {
    expect(trumpSummary(viewWith({ mode: null }))).toMatch(/not settled/);
    expect(trumpSummary(viewWith({ mode: 'HIDDEN', trumpSuit: null }))).toMatch(/face down/);
    expect(trumpSummary(viewWith({ mode: 'KATTE', trumpSuit: null }))).toMatch(/first card off suit/);
    expect(trumpSummary(viewWith({ mode: 'KATTE', trumpSuit: 'clubs' }))).toMatch(/clubs are trump/);
  });
});

describe('which trick is shown', () => {
  it('shows the one being played', () => {
    const plays = [{ playerId: 'p1', card: card('h1', 'hearts'), countedAsTrump: false }];
    const view = viewWith({ currentTrick: { leadSuit: 'hearts', plays } as never });
    const shown = trickOnDisplay(view);
    expect(shown.plays).toHaveLength(1);
    expect(shown.finished).toBe(false);
  });

  it('keeps the finished one on the table until the next card lands', () => {
    const view = viewWith({
      currentTrick: { leadSuit: null, plays: [] },
      lastTrick: {
        winnerPlayerId: 'p3',
        winningTeamId: 'TEAM_A',
        mindis: 1,
        plays: [{ playerId: 'p3', card: card('h1', 'hearts'), countedAsTrump: false }],
      } as never,
    });
    const shown = trickOnDisplay(view);
    expect(shown.finished).toBe(true);
    expect(shown.winnerPlayerId).toBe('p3');
  });

  it('shows nothing before the first card of a hand', () => {
    const view = viewWith({ currentTrick: { leadSuit: null, plays: [] }, lastTrick: null });
    expect(trickOnDisplay(view).plays).toEqual([]);
  });
});
