import { GAMES } from '@bukharo/shared';

import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { useBukharo } from './state/useBukharo';

export function App() {
  const app = useBukharo();
  const room = app.room;

  const screen = (): JSX.Element => {
    if (!room) return <Home app={app} />;
    if (!room.game || room.status === 'LOBBY') return <Lobby app={app} />;

    // One table per game. Until a game has one, the room still works — the
    // lobby, the scores and the log are all game-agnostic — so the honest
    // thing is to say so rather than render the wrong table.
    if (room.game.gameId === 'bukharo') return <Table app={app} game={room.game.view} />;
    return (
      <main className="screen">
        <div className="panel">
          <h2 className="panel__title">{GAMES[room.game.gameId].name}</h2>
          <p>
            The rules for this game are in place and the room is running, but its table has not
            been drawn yet.
          </p>
          <button type="button" className="button button--ghost button--block" onClick={app.leaveRoom}>
            Leave room
          </button>
        </div>
      </main>
    );
  };

  return (
    <div className="app">
      {app.status !== 'open' && (
        <div className="connbar" role="status" aria-live="polite">
          {app.status === 'connecting' && 'Connecting…'}
          {app.status === 'reconnecting' && 'Reconnecting — your seat is being held…'}
          {app.status === 'closed' && 'Disconnected.'}
        </div>
      )}

      {screen()}

      <div className="toasts" aria-live="assertive">
        {app.toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className={`toast toast--${toast.tone}`}
            onClick={() => app.dismissToast(toast.id)}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </div>
  );
}
