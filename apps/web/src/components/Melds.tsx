import type { Meld, NaturalRank, TeamId } from '@bukharo/game-engine';

import { PlayingCard } from './PlayingCard';
import { SUIT_SYMBOL } from '../ui/cards';

interface Props {
  melds: Meld[];
  teamId: TeamId;
  title: string;
  isOpened: boolean;
  wildRank: NaturalRank | null;
  /** Set when the player is choosing a meld to extend. */
  selectableMeldId?: string | null;
  onSelectMeld?(meldId: string): void;
  canAdd?: boolean;
}

export function Melds({
  melds,
  teamId,
  title,
  isOpened,
  wildRank,
  selectableMeldId,
  onSelectMeld,
  canAdd = false,
}: Props) {
  const teamMelds = melds.filter((m) => m.teamId === teamId);

  return (
    <section className="melds" aria-label={`${title} melds`}>
      <header className="melds__header">
        <h3>{title}</h3>
        <span className={`badge ${isOpened ? 'badge--open' : 'badge--closed'}`}>
          {isOpened ? 'Open' : 'Not open'}
        </span>
      </header>

      {teamMelds.length === 0 && (
        <p className="melds__empty">
          {isOpened ? 'No melds yet.' : 'Needs a clean run of 4+ to open.'}
        </p>
      )}

      <div className="melds__list">
        {teamMelds.map((meld) => {
          const selected = selectableMeldId === meld.id;
          const Wrapper = canAdd && onSelectMeld ? 'button' : 'div';
          return (
            <Wrapper
              key={meld.id}
              type={canAdd && onSelectMeld ? 'button' : undefined}
              className={`meld ${selected ? 'is-selected' : ''} ${canAdd ? 'meld--selectable' : ''}`}
              onClick={canAdd && onSelectMeld ? () => onSelectMeld(meld.id) : undefined}
              aria-pressed={canAdd && onSelectMeld ? selected : undefined}
            >
              <div className="meld__cards">
                {meld.cards.map((meldCard) => (
                  <PlayingCard
                    key={meldCard.card.id}
                    card={meldCard.card}
                    wildRank={wildRank}
                    size="sm"
                    representing={
                      meldCard.role === 'WILD'
                        ? `${meldCard.representedRank}${
                            meldCard.representedSuit ? SUIT_SYMBOL[meldCard.representedSuit] : ''
                          }`
                        : undefined
                    }
                  />
                ))}
              </div>
              <div className="meld__meta">
                <span className="meld__type">
                  {meld.type === 'RUN' ? 'Run' : 'Set'} · {meld.cards.length}
                </span>
                {meld.isBucharo && (
                  <span
                    className={`ribbon ${meld.bucharoBonusAwarded === 'CLEAN' ? 'ribbon--clean' : 'ribbon--dirty'}`}
                  >
                    {meld.bucharoBonusAwarded === 'CLEAN' ? 'CLEAN BUCHARO +200' : 'DIRTY BUCHARO +100'}
                  </span>
                )}
                {!meld.isBucharo && !meld.isClean && <span className="meld__tag">has wild</span>}
              </div>
            </Wrapper>
          );
        })}
      </div>
    </section>
  );
}
