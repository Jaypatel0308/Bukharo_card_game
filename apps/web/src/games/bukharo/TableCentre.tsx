import type { GameView } from '@bukharo/game-engine';

import { CardBack, CardSlot, PlayingCard } from '../../components/PlayingCard';

interface Props {
  game: GameView;
  onInspectDiscard(): void;
}

/**
 * The middle of the table, read left to right: the wild card that sets the
 * round's rank, the stock you draw from, then the discard pile.
 */
export function TableCentre({ game, onInspectDiscard }: Props) {
  const topDiscard = game.discardPile[game.discardPile.length - 1];

  return (
    <div className="pileArea">
      <div className="pile pile--wild">
        {game.wildCard ? (
          <PlayingCard card={game.wildCard} wildRank={game.wildRank} />
        ) : (
          <CardSlot label="No wild card this round" />
        )}
        <span className="pile__label">
          Wild <span className="pile__wildRank">{game.wildRank ?? '—'}</span>
        </span>
        <span className="sr-only">
          Every {game.wildRank ?? 'no'} and every joker is wild this round.
        </span>
      </div>

      <div className="pile">
        {game.stockCount > 0 ? (
          <CardBack count={game.stockCount} label={`Stock, ${game.stockCount} cards`} />
        ) : (
          <CardSlot label="Stock is empty" />
        )}
        <span className="pile__label">Stock</span>
      </div>

      <button
        type="button"
        className="pile pile--button"
        onClick={onInspectDiscard}
        aria-label={
          topDiscard
            ? `Discard pile, ${game.discardPile.length} cards. Open to see them all.`
            : 'Discard pile is empty'
        }
      >
        {topDiscard ? (
          <PlayingCard card={topDiscard} wildRank={game.wildRank} />
        ) : (
          <CardSlot label="Discard pile is empty" />
        )}
        <span className="pile__label">Discard · {game.discardPile.length}</span>
      </button>
    </div>
  );
}
