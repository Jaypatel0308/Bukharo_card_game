import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ActionBar } from './ActionBar';

afterEach(cleanup);

const handlers = () => ({
  onDraw: vi.fn(),
  onTakePile: vi.fn(),
  onSeePile: vi.fn(),
  onMeld: vi.fn(),
  onAddToMeld: vi.fn(),
  onDiscard: vi.fn(),
  onClear: vi.fn(),
});

const BASE = {
  discardCount: 3,
  meldLabel: 'Open with 4+',
  canDraw: false,
  canMeld: false,
  canAddToMeld: false,
  canDiscard: false,
  hasSelection: false,
};

const order = () => screen.getAllByRole('button').map((b) => b.textContent);

describe('ActionBar', () => {
  /**
   * The bug this guards: the bar used to swap its contents between the draw
   * and play phases, so a button could change identity under a waiting
   * player's finger and a tap meant for the meld button drew a card instead.
   */
  it('keeps the same buttons in the same order in every phase', () => {
    const expected = [
      'Draw card',
      'Take pile (3)',
      'See pile',
      'Open with 4+',
      'Add to meld',
      'Discard',
      'Clear',
    ];

    const phases = [
      { ...BASE }, // not your turn
      { ...BASE, canDraw: true }, // your draw phase
      { ...BASE, canMeld: true, canDiscard: true, hasSelection: true }, // your play phase
      { ...BASE, canDiscard: true, hasSelection: true }, // one card left
    ];

    for (const phase of phases) {
      const { unmount } = render(<ActionBar {...phase} {...handlers()} />);
      expect(order()).toEqual(expected);
      unmount();
    }
  });

  it('enables each button only when its own rule allows it', () => {
    render(<ActionBar {...BASE} canDraw {...handlers()} />);
    const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

    expect(button('Draw card').disabled).toBe(false);
    expect(button('Take pile (3)').disabled).toBe(false);
    expect(button('Open with 4+').disabled).toBe(true);
    expect(button('Add to meld').disabled).toBe(true);
    expect(button('Discard').disabled).toBe(true);
    expect(button('Clear').disabled).toBe(true);
  });

  it('never lets a player meld or discard before drawing', () => {
    render(<ActionBar {...BASE} canDraw {...handlers()} />);
    expect((screen.getByRole('button', { name: 'Open with 4+' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the pile only when there is one', () => {
    render(<ActionBar {...BASE} discardCount={0} canDraw {...handlers()} />);
    expect((screen.getByRole('button', { name: 'Take pile (0)' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'See pile' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets anyone inspect the pile, even out of turn', () => {
    render(<ActionBar {...BASE} {...handlers()} />);
    expect((screen.getByRole('button', { name: 'See pile' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('wires each button to its own action', () => {
    const spies = handlers();
    render(<ActionBar {...BASE} canDraw canMeld canAddToMeld canDiscard hasSelection {...spies} />);

    for (const [name, spy] of [
      ['Draw card', spies.onDraw],
      ['Take pile (3)', spies.onTakePile],
      ['See pile', spies.onSeePile],
      ['Open with 4+', spies.onMeld],
      ['Add to meld', spies.onAddToMeld],
      ['Discard', spies.onDiscard],
      ['Clear', spies.onClear],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(spy).toHaveBeenCalledOnce();
    }
  });

  it('renames the meld button once the team has opened', () => {
    render(<ActionBar {...BASE} meldLabel="Create meld" {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Create meld' })).toBeTruthy();
  });
});
