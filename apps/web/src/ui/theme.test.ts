import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_THEME, THEMES, applyTheme, isKnownTheme, loadTheme, saveTheme } from './theme';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('themes', () => {
  it('offers distinct themes, each with a name and a swatch', () => {
    expect(THEMES.length).toBeGreaterThan(1);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const theme of THEMES) {
      expect(theme.name).toBeTruthy();
      expect(theme.swatch).toHaveLength(2);
      for (const colour of theme.swatch) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('defaults when nothing has been chosen', () => {
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it('remembers a choice', () => {
    saveTheme('midnight');
    expect(loadTheme()).toBe('midnight');
  });

  it('ignores a stored value it does not recognise', () => {
    // A theme removed in a later version must not leave the app unstyled.
    window.localStorage.setItem('bukharo.theme', 'chartreuse');
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it('knows which ids are real', () => {
    expect(isKnownTheme('emerald')).toBe(true);
    expect(isKnownTheme('nonsense')).toBe(false);
    expect(isKnownTheme(null)).toBe(false);
    expect(isKnownTheme(undefined)).toBe(false);
  });

  it('applies a theme to the document', () => {
    applyTheme('claret');
    expect(document.documentElement.dataset.theme).toBe('claret');
  });

  it('falls back rather than applying a theme that does not exist', () => {
    applyTheme('nonsense');
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });
});
