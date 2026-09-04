import type { JudgementView } from '@bukharo/shared';

import { trumpLabel } from './rules';
import type { Bukharo } from '../../state/useBukharo';

/**
 * The whole match at a glance: every round down the page, every player across.
 *
 * Each cell carries the points and, under them, what was judged against what
 * was taken — because in Judgement a zero is not the same failure as a zero,
 * and "I said three and got two" is the thing you actually want to see.
 */
export function ScoreBoard({
  view,
  onClose,
  isResult = false,
  isHost = false,
  app,
}: {
  view: JudgementView;
  onClose?: () => void;
  isResult?: boolean;
  isHost?: boolean;
  app?: Bukharo;
}) {
  const players = [...view.players].sort((a, b) => a.position - b.position);
  const over = view.status === 'MATCH_END';
  const winners = view.players.filter((p) => view.winnerPlayerIds.includes(p.id));
  const best = Math.max(...view.players.map((p) => p.score));

  const title = (): string => {
    if (over) {
      return winners.length === 1
        ? `${winners[0]!.displayName} wins`
        : `${winners.map((w) => w.displayName).join(' and ')} share the win`;
    }
    if (isResult) return `Round ${view.roundNumber} of ${view.totalRounds}`;
    return 'Score board';
  };

  return (
    <div
      className={`modal ${isResult ? 'modal--full' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={isResult ? 'Round result' : 'Score board'}
    >
      <div className="modal__body modal__body--wide">
        <h2 className="result__title">{title()}</h2>

        <div className="scoreScroll">
          <table className="scoreTable">
            <thead>
              <tr>
                <th className="scoreTable__trump">Trump</th>
                <th className="scoreTable__round">Round</th>
                {players.map((player) => (
                  <th key={player.id} className="scoreTable__player">
                    {player.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.roundHistory.map((round) => (
                <tr key={round.roundNumber}>
                  <td className="scoreTable__trump">
                    {trumpLabel(round.trump)} <span className="scoreTable__suit">{round.trump}</span>
                  </td>
                  <td className="scoreTable__round">{round.roundNumber}</td>
                  {players.map((player) => {
                    const line = round.lines.find((l) => l.playerId === player.id);
                    if (!line) return <td key={player.id}>—</td>;
                    const made = line.scored > 0;
                    return (
                      <td key={player.id} className={made ? 'is-made' : 'is-missed'}>
                        <span className="scoreTable__points">{line.scored}</span>
                        <span className="scoreTable__detail">
                          {line.bid} → {line.tricksWon}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {view.roundHistory.length === 0 && (
                <tr>
                  <td colSpan={2 + players.length} className="scoreTable__empty">
                    No rounds finished yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="scoreTable__trump" />
                <td className="scoreTable__round">Total</td>
                {players.map((player) => (
                  <td
                    key={player.id}
                    className={`scoreTable__total ${player.score === best ? 'is-leading' : ''}`}
                  >
                    {player.score}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="modal__actions modal__actions--stack">
          {isResult ? (
            over ? (
              <>
                {isHost && app && (
                  <button type="button" className="button button--primary" onClick={app.restartMatch}>
                    Play again
                  </button>
                )}
                {app && (
                  <button type="button" className="button button--ghost" onClick={app.leaveRoom}>
                    Leave room
                  </button>
                )}
              </>
            ) : isHost && app ? (
              <button type="button" className="button button--primary" onClick={app.nextRound}>
                Next round
              </button>
            ) : (
              <p className="hint">Waiting for the host to deal the next round…</p>
            )
          ) : (
            <button type="button" className="button button--primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
