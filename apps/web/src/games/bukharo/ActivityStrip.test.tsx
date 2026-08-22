import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DEFAULT_RULES, createMatch, seededRng, viewFor } from '@bukharo/game-engine';
import type { GameView } from '@bukharo/game-engine';

import { ActivityStrip } from './ActivityStrip';

afterEach(cleanup);

const SEATS = [
  { id: 'p1', displayName: 'Rahul', seat: 'NORTH' as const },
  { id: 'p2', displayName: 'Maya', seat: 'EAST' as const },
  { id: 'p3', displayName: 'Priya', seat: 'SOUTH' as const },
  { id: 'p4', displayName: 'Sam', seat: 'WEST' as const },
];

function viewFrom(overrides: Partial<GameView> = {}, viewerId = 'p1'): GameView {
  const state = createMatch({
    roomId: 'r',
    seats: SEATS,
    targetScore: 2000,
    rules: DEFAULT_RULES,
    rng: seededRng(7),
  });
  return { ...viewFor(state, viewerId), ...overrides };
}

describe('ActivityStrip', () => {
  it('says what the player on turn is doing, by name', () => {
    const game = viewFrom({ currentPlayerId: 'p2', turnPhase: 'AWAITING_DRAW' });
    render(<ActivityStrip game={game} disconnected={new Set()} />);
    expect(screen.getByText(/Maya is choosing the stock or the pile/)).toBeTruthy();
  });

  it('addresses you differently from everyone else', () => {
    const game = viewFrom({ currentPlayerId: 'p1', turnPhase: 'AWAITING_DISCARD' });
    render(<ActivityStrip game={game} disconnected={new Set()} />);
    expect(screen.getByText(/You are picking a card to throw/)).toBeTruthy();
  });

  it('follows the phase', () => {
    for (const [phase, expected] of [
      ['AWAITING_DRAW', /choosing the stock or the pile/],
      ['PLAYING_CARDS', /looking at their hand/],
      ['AWAITING_DISCARD', /picking a discard/],
    ] as const) {
      const game = viewFrom({ currentPlayerId: 'p2', turnPhase: phase });
      const { unmount } = render(<ActivityStrip game={game} disconnected={new Set()} />);
      expect(screen.getByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it('says so when the player on turn has dropped out', () => {
    const game = viewFrom({ currentPlayerId: 'p2' });
    render(<ActivityStrip game={game} disconnected={new Set(['p2'])} />);
    expect(screen.getByText(/Maya is disconnected/)).toBeTruthy();
  });

  it('shows the last thing that happened', () => {
    const game = viewFrom({ currentPlayerId: 'p2' });
    render(<ActivityStrip game={game} disconnected={new Set()} />);
    // The deal is the most recent entry on a fresh game.
    expect(screen.getByText(/Round 1 started/)).toBeTruthy();
  });

  it('is announced politely rather than interrupting', () => {
    const game = viewFrom();
    const { container } = render(<ActivityStrip game={game} disconnected={new Set()} />);
    const strip = container.querySelector('.activity');
    expect(strip?.getAttribute('aria-live')).toBe('polite');
  });
});
