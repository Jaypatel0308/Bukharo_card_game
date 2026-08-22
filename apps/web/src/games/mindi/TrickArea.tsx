import type { MindiView } from '@bukharo/shared';

import { PlayingCard } from '../../components/PlayingCard';
import { SUIT_SYMBOL } from '../../ui/cards';
import { trickOnDisplay, trumpSummary } from './rules';

/**
 * The middle of the table: what has been played into this trick, who played
 * each card, and who took the last one.
 *
 * The finished trick stays on screen until the next card lands, so a player
 * who looked away still sees how it went.
 */
export function TrickArea({ view }: { view: MindiView }) {
  const { plays, winnerPlayerId, finished } = trickOnDisplay(view);
  const nameOf = (playerId: string) =>
    view.players.find((p) => p.id === playerId)?.displayName ?? 'Someone';

  return (
    <section className="trick" aria-label="The trick on the table">
      <header className="trick__header">
        <span className={`trick__trump ${view.trumpSuit ? 'is-set' : ''}`}>
          {view.trumpSuit ? (
            <>
              <span aria-hidden="true">{SUIT_SYMBOL[view.trumpSuit]}</span> trump
            </>
          ) : (
            'No trump'
          )}
        </span>
        <span className="trick__note">{trumpSummary(view)}</span>
      </header>

      {plays.length === 0 ? (
        <p className="trick__empty">
          {view.status === 'CHOOSING_MODE'
            ? `${nameOf(view.chooserId)} is deciding how trump is set.`
            : 'Waiting for the first card.'}
        </p>
      ) : (
        <ol className="trick__plays">
          {plays.map((play) => (
            <li
              key={play.card.id}
              className={`trick__play ${winnerPlayerId === play.playerId ? 'is-winner' : ''}`}
            >
              <PlayingCard card={play.card} size="sm" />
              <span className="trick__who">{nameOf(play.playerId)}</span>
            </li>
          ))}
        </ol>
      )}

      {finished && winnerPlayerId && (
        <p className="trick__result" role="status">
          {nameOf(winnerPlayerId)} took it
          {view.lastTrick && view.lastTrick.mindis > 0
            ? ` with ${view.lastTrick.mindis} Mindi${view.lastTrick.mindis === 1 ? '' : 's'}`
            : ''}
          .
        </p>
      )}
    </section>
  );
}
