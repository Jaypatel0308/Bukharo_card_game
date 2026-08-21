import { useState } from 'react';
import { GAME_IDS, GAMES, TARGET_SCORE_OPTIONS, type GameId } from '@bukharo/shared';

import { ThemePicker } from '../components/ThemePicker';
import type { Bukharo } from '../state/useBukharo';
import { roomCodeFromUrl } from '../state/useBukharo';

const NAME_KEY = 'bukharo.name';

export function Home({ app }: { app: Bukharo }) {
  const initialCode = roomCodeFromUrl();
  const [mode, setMode] = useState<'create' | 'join'>(initialCode ? 'join' : 'create');
  const [name, setName] = useState(() => {
    try {
      return window.localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [code, setCode] = useState(initialCode);
  const [targetScore, setTargetScore] = useState(2000);
  const [gameId, setGameId] = useState<GameId>(GAME_IDS[0]!);

  const remember = (value: string): void => {
    try {
      window.localStorage.setItem(NAME_KEY, value);
    } catch {
      /* ignore */
    }
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    remember(trimmed);
    if (mode === 'create') app.createRoom(trimmed, targetScore, gameId);
    else app.joinRoom(trimmed, code.trim());
  };

  const canSubmit = name.trim().length > 0 && (mode === 'create' || code.trim().length >= 4);

  return (
    <main className="screen screen--home">
      <header className="home__header">
        <h1 className="home__title">Bukharo</h1>
        <p className="home__tagline">Four players. Two teams. One very long argument about wild cards.</p>
      </header>

      <div className="panel">
        <div className="tabs" role="tablist" aria-label="Create or join a room">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={`tab ${mode === 'create' ? 'is-active' : ''}`}
            onClick={() => setMode('create')}
          >
            Create private room
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={`tab ${mode === 'join' ? 'is-active' : ''}`}
            onClick={() => setMode('join')}
          >
            Join room
          </button>
        </div>

        <form className="form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Your name</span>
            <input
              className="field__input"
              value={name}
              maxLength={20}
              autoComplete="nickname"
              placeholder="e.g. Rahul"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {mode === 'join' ? (
            <label className="field">
              <span className="field__label">Room code</span>
              <input
                className="field__input field__input--code"
                value={code}
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="BKH7Q"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </label>
          ) : (
            <>
              {GAME_IDS.length > 1 && (
                <fieldset className="field">
                  <legend className="field__label">Game</legend>
                  <div className="gamePicker">
                    {GAME_IDS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={`gameChoice ${gameId === id ? 'is-active' : ''}`}
                        aria-pressed={gameId === id}
                        onClick={() => setGameId(id)}
                      >
                        <span className="gameChoice__name">{GAMES[id].name}</span>
                        <span className="gameChoice__tagline">{GAMES[id].tagline}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              <fieldset className="field">
                <legend className="field__label">Play to</legend>
                <div className="segmented">
                  {TARGET_SCORE_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`segmented__item ${targetScore === value ? 'is-active' : ''}`}
                      aria-pressed={targetScore === value}
                      onClick={() => setTargetScore(value)}
                    >
                      {value.toLocaleString()}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          <button className="button button--primary button--block" type="submit" disabled={!canSubmit}>
            {mode === 'create' ? 'Create room' : 'Join game'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2 className="panel__title">Table theme</h2>
        <ThemePicker />
      </div>

      <details className="rules">
        <summary>How Bukharo works</summary>
        <ul>
          <li>Two decks and four jokers. Everyone gets 13 cards.</li>
          <li>One card from the middle of the stock sets the wild rank for the round.</li>
          <li>
            Your team opens with a <strong>clean run of 4+ cards in one suit</strong> — no wilds. After that
            either partner can meld freely.
          </li>
          <li>Take the whole discard pile any time on your turn. No qualification needed.</li>
          <li>7+ cards in a meld is a Bucharo: +200 clean, +100 dirty.</li>
          <li>Empty your hand and you collect the 13-card Bucharoo for +100.</li>
          <li>Go out by discarding your last card for +100.</li>
        </ul>
      </details>
    </main>
  );
}
