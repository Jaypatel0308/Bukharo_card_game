import { describe, expect, it } from 'vitest';

import { MAX_VISIBLE, MIN_VISIBLE, fanOverlapFor, fanVisibleFraction } from './meldFan';

describe('meld fan overlap', () => {
  it('never hides the corner index, however long the meld', () => {
    for (let count = 1; count <= 20; count++) {
      expect(fanVisibleFraction(count)).toBeGreaterThanOrEqual(MIN_VISIBLE);
      expect(fanVisibleFraction(count)).toBeLessThanOrEqual(MAX_VISIBLE);
    }
  });

  it('compresses as a meld grows, never the other way', () => {
    for (let count = 2; count <= 20; count++) {
      expect(fanVisibleFraction(count)).toBeLessThanOrEqual(fanVisibleFraction(count - 1));
    }
  });

  it('leaves short melds airy and squeezes a Bucharo', () => {
    expect(fanVisibleFraction(3)).toBe(MAX_VISIBLE);
    expect(fanVisibleFraction(7)).toBeLessThan(MAX_VISIBLE);
    expect(fanVisibleFraction(11)).toBe(MIN_VISIBLE);
  });

  it('reports the hidden fraction the layout actually needs', () => {
    expect(fanOverlapFor(3)).toBeCloseTo(1 - MAX_VISIBLE, 3);
    expect(fanOverlapFor(11)).toBeCloseTo(1 - MIN_VISIBLE, 3);
  });

  it('keeps a ten-card Bucharo inside a phone screen', () => {
    // A 2.5rem card at 16px root is 40px. Ten cards, one full and nine slivers,
    // must fit a 360px viewport with room for the meld's own padding.
    const cardPx = 40;
    const width = cardPx + 9 * cardPx * fanVisibleFraction(10);
    expect(width).toBeLessThan(300);
  });
});
