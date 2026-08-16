import type { Card, NaturalRank } from '@bukharo/game-engine';

import { SUIT_SYMBOL, cardLabel, isRedSuit, isWild } from '../ui/cards';

interface Props {
  card: Card;
  wildRank: NaturalRank | null;
  selected?: boolean;
  size?: 'sm' | 'md';
  /** Shown on melded cards where a wild stands in for something else. */
  representing?: string;
  /** Marks a card that arrived this turn from the stock or the discard pile. */
  isNew?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export function PlayingCard({
  card,
  wildRank,
  selected = false,
  size = 'md',
  representing,
  isNew = false,
  onClick,
  disabled = false,
}: Props) {
  const wild = isWild(card, wildRank);
  const classes = [
    'card',
    `card--${size}`,
    isRedSuit(card.suit) ? 'card--red' : 'card--black',
    selected ? 'is-selected' : '',
    wild ? 'is-wild' : '',
    isNew ? 'is-new' : '',
    onClick ? 'card--button' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const label = [
    cardLabel(card, wildRank),
    representing ? `playing as ${representing}` : '',
    isNew ? 'just picked up' : '',
  ]
    .filter(Boolean)
    .join(', ');

  const content = (
    <>
      <span className="card__corner" aria-hidden="true">
        {card.isJoker ? '★' : card.rank}
      </span>
      <span className="card__suit" aria-hidden="true">
        {card.isJoker ? 'JKR' : SUIT_SYMBOL[card.suit!]}
      </span>
      {/* A glyph, not just a colour, so the wild status survives colour-blindness (§74). */}
      {wild && (
        <span className="card__wild" aria-hidden="true">
          W
        </span>
      )}
      {isNew && (
        <span className="card__new" aria-hidden="true">
          ●
        </span>
      )}
      {representing && (
        <span className="card__representing" aria-hidden="true">
          {representing}
        </span>
      )}
    </>
  );

  if (!onClick) {
    return (
      <div className={classes} role="img" aria-label={label}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function CardBack({ count, label }: { count?: number; label: string }) {
  return (
    <div className="card card--back" role="img" aria-label={label}>
      <span className="card__backPattern" aria-hidden="true" />
      {count !== undefined && <span className="card__count">{count}</span>}
    </div>
  );
}
