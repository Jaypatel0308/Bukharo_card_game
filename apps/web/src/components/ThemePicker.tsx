import { useState } from 'react';

import { THEMES, applyTheme, loadTheme, saveTheme } from '../ui/theme';

/** Swatches rather than a dropdown: the choice is a colour, so show the colour. */
export function ThemePicker({ label = 'Table theme' }: { label?: string }) {
  const [current, setCurrent] = useState(loadTheme);

  const choose = (id: string): void => {
    setCurrent(id);
    saveTheme(id);
    applyTheme(id);
  };

  return (
    <div className="themePicker" role="group" aria-label={label}>
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className={`themeSwatch ${current === theme.id ? 'is-active' : ''}`}
          aria-pressed={current === theme.id}
          onClick={() => choose(theme.id)}
          title={theme.name}
        >
          <span
            className="themeSwatch__colours"
            aria-hidden="true"
            style={{
              background: `linear-gradient(135deg, ${theme.swatch[0]} 0 55%, ${theme.swatch[1]} 55% 100%)`,
            }}
          />
          <span className="themeSwatch__name">{theme.name}</span>
        </button>
      ))}
    </div>
  );
}
