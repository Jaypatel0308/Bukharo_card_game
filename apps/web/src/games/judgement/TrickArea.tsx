import type { JudgementView } from '@bukharo/shared';

import { PlayingCard } from '../../components/PlayingCard';

/**
 * The trick in progress, or the one just finished so the table can see who
 * took it before it clears.
 */
export function TrickArea({ view }: { view: JudgementView }) {
  const showing =
    view.currentTrick.plays.length > 0
      ? { plays: view.currentTrick.plays, winnerPlayerId: null as string | null }
      : view.lastTrick
        ? { plays: view.lastTrick.plays, winnerPlayerId: view.lastTrick.winnerPlayerId }
        : { plays: [], winnerPlayerId: null as string | null };

  const nameOf = (id: string): string =>
    view.players.find((p) => p.id === id)?.displayName ?? 'someone';

  return (
    <div className="trick" aria-label="The current trick">
      {showing.plays.length === 0 ? (
        <p className="trick__empty">
          {view.status === 'BIDDING' ? 'Judging…' : 'Waiting for the lead'}
        </p>
      ) : (
        <ul className="trick__cards">
          {showing.plays.map((play) => (
            <li
              key={`${play.playerId}-${play.card.id}`}
              className={`trick__play ${
                showing.winnerPlayerId === play.playerId ? 'is-winner' : ''
              }`}
            >
              <PlayingCard card={play.card} />
              <span className="trick__who">{nameOf(play.playerId)}</span>
            </li>
          ))}
        </ul>
      )}
      {showing.winnerPlayerId && (
        <p className="trick__result">{nameOf(showing.winnerPlayerId)} took it</p>
      )}
    </div>
  );
}
