import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDeck } from '@bukharo/game-engine';
import type { Card, NaturalRank, Suit } from '@bukharo/game-engine';

import { Hand } from './Hand';

afterEach(cleanup);

const DECK = createDeck();
const card = (rank: NaturalRank, suit: Suit): Card =>
  DECK.find((c) => c.rank === rank && c.suit === suit && c.deckNumber === 1)!;

const FIVE = card('5', 'spades');
const NINE = card('9', 'spades');
const SEVEN = card('7', 'spades');

function renderHand(props: Partial<React.ComponentProps<typeof Hand>> = {}) {
  const onToggle = vi.fn();
  const view = render(
    <Hand cards={[FIVE, NINE]} wildRank={null} selectedIds={[]} onToggle={onToggle} isYourTurn {...props} />,
  );
  return { ...view, onToggle };
}

/** Card buttons in the order they appear in the DOM. */
function labels(): string[] {
  return screen
    .getAllByRole('button')
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((label) => label.includes('of ') || label.includes('Joker'));
}

describe('Hand', () => {
  it('renders each card with a spoken label', () => {
    renderHand();
    expect(labels()).toEqual(['5 of spades', '9 of spades']);
  });

  it('reports a tap on a card', () => {
    const { onToggle } = renderHand();
    fireEvent.click(screen.getByRole('button', { name: '5 of spades' }));
    expect(onToggle).toHaveBeenCalledWith(FIVE.id);
  });

  it('marks a drawn card as just picked up, in the label as well as the ring', () => {
    const { rerender, onToggle } = renderHand();
    rerender(
      <Hand cards={[FIVE, NINE, SEVEN]} wildRank={null} selectedIds={[]} onToggle={onToggle} isYourTurn />,
    );
    expect(labels()).toContain('7 of spades, just picked up');
    expect(labels()).toContain('5 of spades');
  });

  it('puts the drawn card in its place rather than at the end', () => {
    const { rerender, onToggle } = renderHand();
    rerender(
      <Hand cards={[FIVE, NINE, SEVEN]} wildRank={null} selectedIds={[]} onToggle={onToggle} isYourTurn />,
    );
    expect(labels()).toEqual([
      '5 of spades',
      '7 of spades, just picked up',
      '9 of spades',
    ]);
  });

  it('does not mark the opening deal as picked up', () => {
    renderHand({ cards: [FIVE, NINE, SEVEN] });
    expect(labels().some((l) => l.includes('just picked up'))).toBe(false);
  });

  it('clears the highlight when the turn passes on', () => {
    const { rerender, onToggle } = renderHand();
    rerender(
      <Hand cards={[FIVE, NINE, SEVEN]} wildRank={null} selectedIds={[]} onToggle={onToggle} isYourTurn />,
    );
    expect(labels().some((l) => l.includes('just picked up'))).toBe(true);

    rerender(
      <Hand cards={[FIVE, NINE, SEVEN]} wildRank={null} selectedIds={[]} onToggle={onToggle} />,
    );
    expect(labels().some((l) => l.includes('just picked up'))).toBe(false);
  });

  it('shows the count and how many arrived', () => {
    const { rerender, onToggle } = renderHand();
    rerender(
      <Hand cards={[FIVE, NINE, SEVEN]} wildRank={null} selectedIds={[]} onToggle={onToggle} isYourTurn />,
    );
    expect(screen.getByText(/3 cards/)).toBeTruthy();
    expect(screen.getByText(/1 just picked up/)).toBeTruthy();
  });

  it('re-sorts on demand', () => {
    renderHand({ cards: [FIVE, NINE, card('A', 'hearts')] });
    fireEvent.click(screen.getByRole('button', { name: 'Points' }));
    // Points sorts high to low: the ace is worth 15, the spades 5 each.
    expect(labels()[0]).toBe('A of hearts');
  });

  it('marks selected cards as pressed for assistive tech', () => {
    renderHand({ selectedIds: [FIVE.id] });
    expect(screen.getByRole('button', { name: '5 of spades' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '9 of spades' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('stays usable when it is not your turn, so a hand can be tidied while waiting', () => {
    const { onToggle } = renderHand({ isYourTurn: false });
    const button = screen.getByRole('button', { name: '5 of spades' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(FIVE.id);
  });

  it('counts what is selected, which does not depend on seeing the lift', () => {
    renderHand({ selectedIds: [FIVE.id] });
    expect(screen.getByText(/1 selected/)).toBeTruthy();
  });
});
