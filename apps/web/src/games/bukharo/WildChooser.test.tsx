import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WildChooser } from './WildChooser';

/**
 * The reading in which nothing is wild carries no assignments, so it used to
 * render as a button with no text on it. A player holding 8, 9 and a 10 in a
 * round where tens are wild was being offered the right answer all along, as
 * a blank.
 */
afterEach(cleanup);

describe('choosing what a wild card represents', () => {
  it('names the reading where nothing is wild', () => {
    render(
      <WildChooser
        options={[[{ cardId: 'h10', representedRank: '7', representedSuit: 'hearts' }], []]}
        wildRank="10"
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const plain = screen.getByRole('button', { name: /ordinary 10/i });
    expect(plain).toBeTruthy();
    expect(plain.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('leaves no button unlabelled, whatever the options', () => {
    render(
      <WildChooser
        options={[[], [{ cardId: 'd10', representedRank: 'A', representedSuit: 'diamonds' }]]}
        wildRank="10"
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent?.trim()).not.toBe('');
    }
  });

  it('passes the empty choice back, so it can actually be picked', () => {
    const onChoose = vi.fn();
    render(
      <WildChooser
        options={[[{ cardId: 'h10', representedRank: '7', representedSuit: 'hearts' }], []]}
        wildRank="10"
        onChoose={onChoose}
        onCancel={vi.fn()}
      />,
    );

    screen.getByRole('button', { name: /ordinary 10/i }).click();
    expect(onChoose).toHaveBeenCalledWith([]);
  });

  it('says what a wild is standing in for', () => {
    render(
      <WildChooser
        options={[[{ cardId: 'h10', representedRank: '7', representedSuit: 'hearts' }], []]}
        wildRank="10"
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Wild as 7/ })).toBeTruthy();
  });
});
