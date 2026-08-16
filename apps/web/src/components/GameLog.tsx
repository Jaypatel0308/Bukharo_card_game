import type { LogEntry } from '@bukharo/game-engine';

export function GameLog({ log, onClose }: { log: LogEntry[]; onClose(): void }) {
  const entries = [...log].reverse();
  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="Game log">
      <div className="drawer__body">
        <header className="drawer__header">
          <h2>Game log</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close game log">
            ✕
          </button>
        </header>
        <ol className="log">
          {entries.map((entry) => (
            <li key={entry.seq} className={`log__item log__item--${entry.type.toLowerCase()}`}>
              <span className="log__time">
                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="log__message">{entry.message}</span>
            </li>
          ))}
          {entries.length === 0 && <li className="log__item">Nothing has happened yet.</li>}
        </ol>
      </div>
    </div>
  );
}
