import { useEffect, useState } from 'react';

interface Props {
  playerName: string;
  waitingSince: number | null;
  graceMs: number;
  isHost: boolean;
  onSkip(): void;
  onEndMatch(): void;
}

/**
 * Shown when the table is waiting on a player who has dropped out (§54).
 *
 * The host gets a way forward, but only once the grace period has run: the
 * commonest cause of a missing player is a phone that dipped under a bridge,
 * and thirty seconds later they are back.
 */
export function StalledTurn({
  playerName,
  waitingSince,
  graceMs,
  isHost,
  onSkip,
  onEndMatch,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const waited = waitingSince ? now - waitingSince : 0;
  const remaining = Math.max(0, Math.ceil((graceMs - waited) / 1000));
  const canSkip = remaining === 0;

  return (
    <section className="stalled" role="status" aria-live="polite">
      <p className="stalled__message">
        Waiting for <strong>{playerName}</strong> to reconnect
        {!canSkip && ` — ${remaining}s`}
      </p>

      {isHost ? (
        <div className="stalled__actions">
          <button type="button" className="button button--tiny" disabled={!canSkip} onClick={onSkip}>
            {canSkip ? `Skip ${playerName}'s turn` : `Skip in ${remaining}s`}
          </button>
          <button
            type="button"
            className="button button--tiny button--danger"
            onClick={() => setConfirmEnd(true)}
          >
            End match
          </button>
        </div>
      ) : (
        <p className="hint">Only the host can move the game on.</p>
      )}

      {confirmEnd && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="End match">
          <div className="modal__body">
            <h2>End this match?</h2>
            <p>
              The match stops here and the round is not scored. Everyone stays in the room and you can
              start a new match afterwards.
            </p>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setConfirmEnd(false)}>
                Keep waiting
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  setConfirmEnd(false);
                  onEndMatch();
                }}
              >
                End match
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
