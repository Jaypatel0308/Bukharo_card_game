import { useEffect, useState } from 'react';
import { GAMES, type GameId } from '@bukharo/shared';

import { ThemePicker } from '../components/ThemePicker';
import { GameSelect } from './GameSelect';
import type { Bukharo } from '../state/useBukharo';
import { roomCodeFromUrl } from '../state/useBukharo';

const NAME_KEY = 'bukharo.name';

/**
 * Everything before there is a room: choose a game, set it up, or join one.
 *
 * Three steps rather than one screen with tabs, because the settings on offer
 * depend on which game is being hosted — the target means a score in one game
 * and a losing tally in the other — and a joiner needs none of them.
 */
type Step = 'select' | 'setup' | 'join';

export function Home({ app }: { app: Bukharo }) {
  const initialCode = roomCodeFromUrl();
  // A room code in the link means they were invited to a table that already
  // has a game, so skip the picker entirely.
  const [step, setStep] = useState<Step>(initialCode ? 'join' : 'select');
  const [gameId, setGameId] = useState<GameId | null>(null);
  const [target, setTarget] = useState(0);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(() => {
    try {
      return window.localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const game = gameId ? GAMES[gameId] : null;

  // The tab said "Bukharo" whatever you were setting up.
  useEffect(() => {
    document.title = game ? `${game.name} · Card Table` : 'Card Table';
  }, [game]);

  const remember = (value: string): void => {
    try {
      window.localStorage.setItem(NAME_KEY, value);
    } catch {
      /* ignore */
    }
  };

  if (step === 'select') {
    return (
      <GameSelect
        onPick={(id) => {
          setGameId(id);
          setTarget(GAMES[id].defaultTarget);
          setStep('setup');
        }}
        onJoinInstead={() => setStep('join')}
      />
    );
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    remember(trimmed);
    if (step === 'setup' && gameId) app.createRoom(trimmed, target, gameId);
    else if (step === 'join') app.joinRoom(trimmed, code.trim());
  };

  const nameField = (
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
  );

  const back = (
    <button type="button" className="backLink" onClick={() => setStep('select')}>
      ← Change game
    </button>
  );

  if (step === 'join') {
    const canJoin = name.trim().length > 0 && code.trim().length >= 4;
    return (
      <main className="screen screen--home">
        <header className="home__header">
          {!initialCode && back}
          <h1 className="home__title">Join a room</h1>
          <p className="home__tagline">The room code decides which game you are playing.</p>
        </header>

        <div className="panel">
          <form className="form" onSubmit={submit}>
            {nameField}
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
            <button className="button button--primary button--block" type="submit" disabled={!canJoin}>
              Join game
            </button>
          </form>
        </div>

        <div className="panel">
          <h2 className="panel__title">Table theme</h2>
          <ThemePicker />
        </div>
      </main>
    );
  }

  // step === 'setup'
  if (!game) return null;
  const canCreate = name.trim().length > 0;

  return (
    <main className="screen screen--home">
      <header className="home__header">
        {back}
        <h1 className="home__title">{game.name}</h1>
        <p className="home__tagline">{game.tagline}</p>
      </header>

      <div className="panel">
        <form className="form" onSubmit={submit}>
          {nameField}

          <fieldset className="field">
            <legend className="field__label">{game.targetLabel}</legend>
            <div className="segmented">
              {game.targetOptions.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`segmented__item ${target === value ? 'is-active' : ''}`}
                  aria-pressed={target === value}
                  onClick={() => setTarget(value)}
                >
                  {value.toLocaleString()}
                </button>
              ))}
            </div>
            <p className="hint">{game.targetHint}</p>
          </fieldset>

          <button className="button button--primary button--block" type="submit" disabled={!canCreate}>
            Create room
          </button>
        </form>
      </div>

      <details className="rules">
        <summary>How {game.name} works</summary>
        <ul>
          {game.rules.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>

      <div className="panel">
        <h2 className="panel__title">Table theme</h2>
        <ThemePicker />
      </div>
    </main>
  );
}
