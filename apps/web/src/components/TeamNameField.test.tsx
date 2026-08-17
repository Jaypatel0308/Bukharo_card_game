import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TeamNameField } from './TeamNameField';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const LABEL = 'Name for the red team';

function setup(value = 'Team A') {
  const onCommit = vi.fn();
  const view = render(<TeamNameField label={LABEL} value={value} onCommit={onCommit} />);
  const input = screen.getByLabelText(LABEL) as HTMLInputElement;
  return { ...view, input, onCommit };
}

describe('TeamNameField', () => {
  /** The reported bug: deleting the last character snapped back to "Team A". */
  it('lets the field be emptied without the name springing back', () => {
    const { input } = setup('Team A');
    fireEvent.focus(input);

    for (const partial of ['Team ', 'Team', 'Tea', 'Te', 'T', '']) {
      fireEvent.change(input, { target: { value: partial } });
      expect(input.value).toBe(partial);
    }
    vi.advanceTimersByTime(2000);
    expect(input.value).toBe('');
  });

  /** The bug hiding behind it: a space was swallowed as it was typed. */
  it('lets a space be typed, so a two word name is possible', () => {
    const { input } = setup('Team A');
    fireEvent.focus(input);

    for (const partial of ['The', 'The ', 'The S', 'The Sharks']) {
      fireEvent.change(input, { target: { value: partial } });
      expect(input.value).toBe(partial);
    }
    expect(input.value).toBe('The Sharks');
  });

  it('does not tell the table about an empty field mid-edit', () => {
    const { input, onCommit } = setup('Team A');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    vi.advanceTimersByTime(2000);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('tells the table once typing pauses', () => {
    const { input, onCommit } = setup('Team A');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Rockets' } });

    vi.advanceTimersByTime(300);
    expect(onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onCommit).toHaveBeenCalledWith('Rockets');
  });

  it('sends only the settled name, not every keystroke', () => {
    const { input, onCommit } = setup('Team A');
    fireEvent.focus(input);
    for (const partial of ['R', 'Ro', 'Roc', 'Rock', 'Rockets']) {
      fireEvent.change(input, { target: { value: partial } });
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(700);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Rockets');
  });

  it('commits on the way out, including an empty box', () => {
    const { input, onCommit } = setup('Team A');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('');
  });

  it('adopts the server’s name when the player is not editing', () => {
    const { input, rerender } = setup('Team A');
    rerender(<TeamNameField label={LABEL} value="Rockets" onCommit={vi.fn()} />);
    expect(input.value).toBe('Rockets');
  });

  it('does not overwrite what someone is halfway through typing', () => {
    const { input, rerender } = setup('Team A');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Roc' } });

    // A broadcast arrives while they are still typing.
    rerender(<TeamNameField label={LABEL} value="Team A" onCommit={vi.fn()} />);
    expect(input.value).toBe('Roc');
  });

  it('restores the last good name when the box is left blank', () => {
    // The server answers a blank name with the default. When that is what it
    // already had there is no broadcast to adopt, so the box must not be left
    // sitting empty.
    const { input, onCommit } = setup('Team A');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith('');
    expect(input.value).toBe('Team A');
  });

  it('keeps a real name on the way out and lets the server confirm it', () => {
    const { input, rerender, onCommit } = setup('Team A');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Rockets' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith('Rockets');
    expect(input.value).toBe('Rockets');

    rerender(<TeamNameField label={LABEL} value="Rockets" onCommit={onCommit} />);
    expect(input.value).toBe('Rockets');
  });
});
