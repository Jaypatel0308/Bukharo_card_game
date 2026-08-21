import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DEFAULT_RULES, createMatch, seededRng, viewFor } from '@bukharo/game-engine';
import type { GameState } from '@bukharo/game-engine';
import type { RoomView } from '@bukharo/shared';

import { Table } from './Table';
import type { Bukharo } from '../state/useBukharo';

afterEach(cleanup);

const SEATS = [
  { id: 'p1', displayName: 'Rahul', seat: 'NORTH' as const },
  { id: 'p2', displayName: 'Maya', seat: 'EAST' as const },
  { id: 'p3', displayName: 'Priya', seat: 'SOUTH' as const },
  { id: 'p4', displayName: 'Sam', seat: 'WEST' as const },
];

function gameState(): GameState {
  return createMatch({
    roomId: 'room_test',
    seats: SEATS,
    targetScore: 2000,
    rules: DEFAULT_RULES,
    rng: seededRng(42),
    teamNames: { TEAM_A: 'Rockets', TEAM_B: 'Comets' },
  });
}

function appFor(state: GameState, viewerId: string): Bukharo {
  const room: RoomView = {
    roomId: 'room_test',
    roomCode: 'BKH7Q',
    gameId: 'bukharo',
    status: 'PLAYING',
    targetScore: 2000,
    hostId: 'p1',
    teamNames: { TEAM_A: 'Rockets', TEAM_B: 'Comets' },
    players: SEATS.map((s, position) => ({
      id: s.id,
      displayName: s.displayName,
      position,
      seatLabel: s.seat,
      teamId: position % 2 === 0 ? ('TEAM_A' as const) : ('TEAM_B' as const),
      connected: true,
      ready: true,
      isHost: s.id === 'p1',
    })),
    game: viewFor(state, viewerId),
    rules: DEFAULT_RULES,
    youId: viewerId,
    cannotStartReason: null,
    waitingForPlayerId: null,
    waitingSince: null,
    disconnectGraceMs: 90_000,
    createdAt: Date.now(),
  };

  return {
    status: 'open',
    room,
    toasts: [],
    dismissToast: vi.fn(),
    pendingWild: null,
    cancelWildChoice: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    setReady: vi.fn(),
    choosePosition: vi.fn(),
    assignPosition: vi.fn(),
    kickPlayer: vi.fn(),
    setTargetScore: vi.fn(),
    setTeamName: vi.fn(),
    endMatch: vi.fn(),
    skipAbsentPlayer: vi.fn(),
    startGame: vi.fn(),
    nextRound: vi.fn(),
    restartMatch: vi.fn(),
    act: vi.fn(),
  };
}

/** The class of each landmark, in the order it appears in the document. */
function layoutOrder(container: HTMLElement): string[] {
  const selector = '.melds--theirs, .pileArea, .melds--yours, .hand, .actionbar';
  return [...container.querySelectorAll(selector)].map((el) => {
    for (const name of ['melds--theirs', 'pileArea', 'melds--yours', 'hand', 'actionbar']) {
      if (el.classList.contains(name)) return name;
    }
    return '?';
  });
}

describe('table layout', () => {
  it('puts the opponents’ melds above the centre and yours below it', () => {
    const state = gameState();
    const { container } = render(<Table app={appFor(state, 'p1')} />);

    expect(layoutOrder(container)).toEqual([
      'melds--theirs',
      'pileArea',
      'melds--yours',
      'hand',
      'actionbar',
    ]);
  });

  it('puts each player’s own team below, whichever team that is', () => {
    const state = gameState();

    // p1 is Team A, p2 is Team B: each should see their own team's melds below.
    for (const [viewerId, nearTeam] of [
      ['p1', 'Rockets'],
      ['p2', 'Comets'],
    ] as const) {
      const { container, unmount } = render(<Table app={appFor(state, viewerId)} />);
      const yours = container.querySelector('.melds--yours');
      expect(yours?.getAttribute('aria-label')).toBe(`${nearTeam} melds`);
      unmount();
    }
  });

  it('shows the centre piles in the order wild, stock, discard', () => {
    const state = gameState();
    const { container } = render(<Table app={appFor(state, 'p1')} />);
    const labels = [...container.querySelectorAll('.pileArea .pile__label')].map((el) =>
      (el.textContent ?? '').trim(),
    );
    expect(labels[0]).toMatch(/^Wild/);
    expect(labels[1]).toMatch(/^Stock/);
    expect(labels[2]).toMatch(/^Discard/);
  });

  it('never renders another player’s cards', () => {
    const state = gameState();
    const { container } = render(<Table app={appFor(state, 'p1')} />);
    const markup = container.innerHTML;

    const opponentCards = state.players.filter((p) => p.id !== 'p1').flatMap((p) => p.hand);
    const ownIds = new Set(state.players.find((p) => p.id === 'p1')!.hand.map((c) => c.id));
    for (const card of opponentCards) {
      if (ownIds.has(card.id)) continue;
      expect(markup).not.toContain(card.id);
    }
  });
});
