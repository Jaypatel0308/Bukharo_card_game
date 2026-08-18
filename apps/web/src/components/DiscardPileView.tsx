import type { Card, NaturalRank } from '@bukharo/game-engine';

import { PlayingCard } from './PlayingCard';

interface Props {
  cards: Card[];
  wildRank: NaturalRank | null;
  /** Set when the viewer may take the pile right now. */
  onTake?: (() => void) | null;
  onClose(): void;
}

/**
 * The whole face-up discard pile (§19). Taking it is a big commitment — it is
 * every card, not just the top one — so the player can read it first.
 *
 * This is a sheet rather than a modal on purpose: it dims and blurs nothing,
 * sits in the upper half of the screen, and lets taps through to the table, so
 * the player can weigh the pile against the hand they are still looking at.
 * The pile is public information, so every player may open it.
 */
export function DiscardPileView({ cards, wildRank, onTake, onClose }: Props) {
  const points = cards.reduce((total, card) => total + card.basePointValue, 0);

  return (
    <div className="sheet">
      <div className="sheet__body" role="dialog" aria-label="Discard pile">
        <header className="sheet__header">
          <h2>Discard pile</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close discard pile">
            ✕
          </button>
        </header>

        {cards.length === 0 ? (
          <p className="sheet__note">The pile is empty — you will have to draw from the stock.</p>
        ) : (
          <>
            <p className="sheet__note">
              {cards.length} card{cards.length === 1 ? '' : 's'} · {points} points · bottom first
            </p>

            <ol className="pileList">
              {cards.map((card, index) => (
                <li key={card.id} className="pileList__item">
                  <PlayingCard card={card} wildRank={wildRank} size="sm" />
                  {index === cards.length - 1 && <span className="pileList__top">top</span>}
                </li>
              ))}
            </ol>
          </>
        )}

        <div className="sheet__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
          {onTake && cards.length > 0 && (
            <button type="button" className="button button--primary" onClick={onTake}>
              Take all {cards.length}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
