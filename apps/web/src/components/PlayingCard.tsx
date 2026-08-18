import type { Card, NaturalRank } from '@bukharo/game-engine';

import { SUIT_SYMBOL, cardLabel, isRedSuit } from '../ui/cards';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  card: Card;
  wildRank: NaturalRank | null;
  selected?: boolean;
  size?: CardSize;
  /** Shown on melded cards where a wild stands in for something else. */
  representing?: string;
  /** Marks a card that arrived this turn from the stock or the discard pile. */
  isNew?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * Pip positions for the number cards, as a real deck lays them out: a three
 * column by seven row grid, with the middle column used only for odd counts and
 * for the sevens and eights. Pips in the lower half are drawn upside down, the
 * way a printed card does it.
 */
const PIP_LAYOUT: Record<string, Array<[column: number, row: number]>> = {
  '2': [[2, 1], [2, 7]],
  '3': [[2, 1], [2, 4], [2, 7]],
  '4': [[1, 1], [3, 1], [1, 7], [3, 7]],
  '5': [[1, 1], [3, 1], [2, 4], [1, 7], [3, 7]],
  '6': [[1, 1], [3, 1], [1, 4], [3, 4], [1, 7], [3, 7]],
  '7': [[1, 1], [3, 1], [2, 2], [1, 4], [3, 4], [1, 7], [3, 7]],
  '8': [[1, 1], [3, 1], [2, 2], [1, 4], [3, 4], [2, 6], [1, 7], [3, 7]],
  '9': [[1, 1], [3, 1], [1, 3], [3, 3], [2, 4], [1, 5], [3, 5], [1, 7], [3, 7]],
  '10': [[1, 1], [3, 1], [1, 3], [3, 3], [2, 2], [2, 6], [1, 5], [3, 5], [1, 7], [3, 7]],
};

const COURT_RANKS = ['J', 'Q', 'K'];

function CardCentre({ card }: { card: Card }) {
  if (card.isJoker) {
    return (
      <span className="card__centre card__centre--joker" aria-hidden="true">
        <span className="card__jokerMark">★</span>
        <span className="card__jokerWord">JOKER</span>
      </span>
    );
  }

  const suit = SUIT_SYMBOL[card.suit!];

  if (card.rank === 'A') {
    return (
      <span className="card__centre card__centre--ace" aria-hidden="true">
        {suit}
      </span>
    );
  }

  if (COURT_RANKS.includes(card.rank)) {
    return (
      <span className="card__centre card__centre--court" aria-hidden="true">
        <span className="card__monogram">{card.rank}</span>
        <span className="card__courtSuit">{suit}</span>
      </span>
    );
  }

  const pips = PIP_LAYOUT[card.rank] ?? [];
  return (
    <span className="card__pips" aria-hidden="true">
      {pips.map(([column, row], index) => (
        <span
          key={index}
          className={`card__pip ${row > 4 ? 'is-inverted' : ''}`}
          style={{ gridColumn: column, gridRow: row }}
        >
          {suit}
        </span>
      ))}
      {/* Small cards cannot show ten legible pips, so they fall back to one. */}
      <span className="card__pipFallback">{suit}</span>
    </span>
  );
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
  const classes = [
    'card',
    `card--${size}`,
    isRedSuit(card.suit) ? 'card--red' : 'card--black',
    card.isJoker ? 'card--joker' : '',
    selected ? 'is-selected' : '',
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

  const index = card.isJoker ? '★' : card.rank;
  const suit = card.isJoker ? '' : SUIT_SYMBOL[card.suit!];

  const content = (
    <>
      <span className="card__index card__index--tl" aria-hidden="true">
        <span className="card__rank">{index}</span>
        <span className="card__suitMark">{suit}</span>
      </span>

      <CardCentre card={card} />

      <span className="card__index card__index--br" aria-hidden="true">
        <span className="card__rank">{index}</span>
        <span className="card__suitMark">{suit}</span>
      </span>

      {selected && (
        <span className="card__chosen" aria-hidden="true">
          ✓
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

export function CardBack({
  count,
  label,
  size = 'md',
}: {
  count?: number;
  label: string;
  size?: CardSize;
}) {
  return (
    <div className={`card card--${size} card--back`} role="img" aria-label={label}>
      <span className="card__backPattern" aria-hidden="true" />
      {count !== undefined && <span className="card__count">{count}</span>}
    </div>
  );
}

/** An empty slot, e.g. an exhausted stock or an empty discard pile. */
export function CardSlot({ label, size = 'md' }: { label: string; size?: CardSize }) {
  return <div className={`card card--${size} card--empty`} role="img" aria-label={label} />;
}
