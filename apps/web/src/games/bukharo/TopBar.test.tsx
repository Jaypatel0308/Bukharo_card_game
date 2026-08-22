import { describe, expect, it } from 'vitest';

import { initialsOf } from '../../ui/teams';

describe('initialsOf', () => {
  it('takes the first letters of a two word name', () => {
    expect(initialsOf('The Sharks')).toBe('TS');
    expect(initialsOf('Team A')).toBe('TA');
  });

  it('takes two letters of a single word', () => {
    expect(initialsOf('Rockets')).toBe('RO');
  });

  it('copes with odd input rather than crashing', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('a')).toBe('A');
  });
});
