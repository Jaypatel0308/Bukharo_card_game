// @vitest-environment node
// Reads the stylesheet as text, so it needs a real file URL rather than the
// http module URL jsdom hands out.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { THEMES } from '../ui/theme';

const css = readFileSync(fileURLToPath(new URL('./themes.css', import.meta.url)), 'utf8');

/**
 * Every theme must define the whole token contract. A theme missing one token
 * silently inherits it from the default block, which reads as a bug nobody can
 * find: one colour from the wrong palette.
 */
const CONTRACT = [
  '--surface-deep',
  '--surface',
  '--surface-raised',
  '--ink',
  '--ink-dim',
  '--line',
  '--accent',
  '--accent-ink',
  '--card-back-a',
  '--card-back-b',
];

function blockFor(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `${selector} should exist in themes.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('themes.css', () => {
  it('defines a block for every theme the app offers', () => {
    for (const theme of THEMES) {
      expect(css).toContain(`[data-theme='${theme.id}']`);
    }
  });

  it('gives every theme the complete token contract', () => {
    for (const theme of THEMES) {
      const block = blockFor(`[data-theme='${theme.id}']`);
      for (const token of CONTRACT) {
        expect(block, `${theme.id} is missing ${token}`).toContain(`${token}:`);
      }
    }
  });

  it('matches each swatch to the theme it advertises', () => {
    for (const theme of THEMES) {
      const block = blockFor(`[data-theme='${theme.id}']`);
      const [surface, accent] = theme.swatch;
      expect(block.toLowerCase(), `${theme.id} swatch surface`).toContain(surface.toLowerCase());
      expect(block.toLowerCase(), `${theme.id} swatch accent`).toContain(accent.toLowerCase());
    }
  });

  it('keeps team colours out of the themes, so red and blue never drift', () => {
    for (const theme of THEMES) {
      const block = blockFor(`[data-theme='${theme.id}']`);
      expect(block).not.toContain('--team-a');
      expect(block).not.toContain('--team-b');
    }
  });
});
