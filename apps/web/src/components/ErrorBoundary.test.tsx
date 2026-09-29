import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

function Boom(): never {
  throw new Error('the table exploded');
}

describe('a render that throws', () => {
  it('shows a way back instead of a blank page', () => {
    // React logs the error itself; quiet it so the run stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: /Something broke/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    spy.mockRestore();
  });

  it('says the seat is still held, because it is', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // The session token lives in local storage, so a reload really does return
    // the player to the table — worth saying rather than leaving them guessing.
    expect(screen.getByText(/seat is still held/i)).toBeTruthy();
    spy.mockRestore();
  });

  it('stays out of the way when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <p>the table</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('the table')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });
});
