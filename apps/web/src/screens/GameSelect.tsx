import { GAME_IDS, GAMES, type GameId } from '@bukharo/shared';

import { ThemePicker } from '../components/ThemePicker';

/**
 * The first screen: which game are we playing?
 *
 * Only the host answers this. Somebody arriving with a room code is joining a
 * table that already has a game, so asking them would be collecting an answer
 * that has to be thrown away — the code decides. They get a way straight past.
 */
export function GameSelect({
  onPick,
  onJoinInstead,
}: {
  onPick(gameId: GameId): void;
  onJoinInstead(): void;
}) {
  return (
    <main className="screen screen--home">
      <header className="home__header">
        <h1 className="home__title">Card Table</h1>
        <p className="home__tagline">Pick a game to host.</p>
      </header>

      <div className="panel">
        <ul className="gameList">
          {GAME_IDS.map((id) => {
            const game = GAMES[id];
            return (
              <li key={id}>
                <button
                  type="button"
                  className="gameCard"
                  onClick={() => onPick(id)}
                  disabled={!game.hasTable}
                >
                  <span className="gameCard__head">
                    <span className="gameCard__name">{game.name}</span>
                    <span className="gameCard__players">{game.playerSummary}</span>
                  </span>
                  <span className="gameCard__tagline">{game.tagline}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel panel--quiet">
        <p className="hint">Been sent a room code?</p>
        <button type="button" className="button button--block" onClick={onJoinInstead}>
          Join a room instead
        </button>
      </div>

      <div className="panel">
        <h2 className="panel__title">Table theme</h2>
        <ThemePicker />
      </div>
    </main>
  );
}
