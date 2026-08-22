import { MindiTable } from './games/mindi/MindiTable';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { BukharoTable } from './games/bukharo/BukharoTable';
import { useBukharo } from './state/useBukharo';

export function App() {
  const app = useBukharo();
  const room = app.room;

  const screen = (): JSX.Element => {
    if (!room) return <Home app={app} />;
    if (!room.game || room.status === 'LOBBY') return <Lobby app={app} />;

    // One table per game, chosen by the tag the server put on the snapshot.
    if (room.game.gameId === 'bukharo') return <BukharoTable app={app} game={room.game.view} />;
    return <MindiTable app={app} view={room.game.view} />;
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
