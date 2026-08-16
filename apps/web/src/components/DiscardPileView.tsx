import type { Card, NaturalRank } from '@bukharo/game-engine';

import { PlayingCard } from './PlayingCard';
import { isWild } from '../ui/cards';

interface Props {
  cards: Card[];
  wildRank: NaturalRank | null;
  /** Set when the viewer may take the pile right now. */
  onTake?: (() => void) | null;
  onClose(): void;
}

/**
 * The whole face-up discard pile (§19). Taking the pile is a big commitment —
 * it is every card, not just the top one — so the player can read it first.
 * The pile is public information: every player sees the same list.
 */
export function DiscardPileView({ cards, wildRank, onTake, onClose }: Props) {
  // Bottom of the pile first, the way it would be spread on a table.
  const points = cards.reduce((total, card) => total + card.basePointValue, 0);
  const wilds = cards.filter((card) => isWild(card, wildRank)).length;

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="Discard pile">
      <div className="drawer__body">
        <header className="drawer__header">
          <h2>Discard pile</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close discard pile">
            ✕
          </button>
        </header>

        {cards.length === 0 ? (
          <p className="drawer__note">The pile is empty — you will have to draw from the stock.</p>
        ) : (
          <>
            <p className="drawer__note">
              {cards.length} card{cards.length === 1 ? '' : 's'} · {points} points
              {wilds > 0 && ` · ${wilds} wild${wilds === 1 ? '' : 's'}`}
            </p>

            <ol className="pileList">
              {cards.map((card, index) => (
                <li key={card.id} className="pileList__item">
                  <PlayingCard card={card} wildRank={wildRank} size="sm" />
                  {index === cards.length - 1 && <span className="pileList__top">top</span>}
                </li>
              ))}
            </ol>
            <p className="hint">Bottom of the pile first. Taking it takes every card.</p>
          </>
        )}

        <div className="modal__actions">
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
