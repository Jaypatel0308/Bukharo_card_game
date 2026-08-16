/**
 * Theme selection.
 *
 * A theme is nothing but a block of custom properties in styles/themes.css,
 * applied by setting `data-theme` on the document element. Adding one means
 * adding a block there and an entry here — no component changes.
 */
export interface Theme {
  id: string;
  name: string;
  /** Two colours describing the theme in a swatch. */
  swatch: [table: string, accent: string];
}

export const THEMES: Theme[] = [
  { id: 'emerald', name: 'Emerald', swatch: ['#0e3527', '#f0c968'] },
  { id: 'midnight', name: 'Midnight', swatch: ['#141b32', '#7dd3fc'] },
  { id: 'claret', name: 'Claret', swatch: ['#33161e', '#e8b04b'] },
  { id: 'slate', name: 'Slate', swatch: ['#1b2129', '#5eead4'] },
];

export const DEFAULT_THEME = THEMES[0]!.id;

const STORAGE_KEY = 'bukharo.theme';

export function isKnownTheme(id: string | null | undefined): boolean {
  return THEMES.some((theme) => theme.id === id);
}

/** Falls back to the default for anything unrecognised or unreadable. */
export function loadTheme(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isKnownTheme(stored) ? stored! : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private browsing — the choice simply will not outlive the session */
  }
}

export function applyTheme(id: string): void {
  const theme = isKnownTheme(id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
}
