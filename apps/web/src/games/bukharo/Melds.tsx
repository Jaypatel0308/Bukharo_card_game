import type { Meld, NaturalRank, TeamId } from '@bukharo/game-engine';

import { PlayingCard } from '../../components/PlayingCard';
import { initialsOf } from '../../ui/teams';
import { SUIT_SYMBOL } from '../../ui/cards';
import { fanOverlapFor } from './meldFan';

interface Props {
  melds: Meld[];
  teamId: TeamId;
  title: string;
  isOpened: boolean;
  wildRank: NaturalRank | null;
  openingRunMinimum: number;
  /** True for the viewer's own team, which sits on their side of the table. */
  isYours?: boolean;
  /** Set when the player is choosing a meld to extend. */
  selectableMeldId?: string | null;
  onSelectMeld?(meldId: string): void;
  canAdd?: boolean;
}

/**
 * A team's melds, laid out like a solitaire tableau: each meld is a fan of
 * overlapping cards showing every corner index, and the fans sit side by side,
 * wrapping onto the next line when the row fills. Seven-card Bucharos stay
 * compact enough to read at a glance on a phone.
 */
export function Melds({
  melds,
  teamId,
  title,
  isOpened,
  wildRank,
  openingRunMinimum,
  isYours = false,
  selectableMeldId,
  onSelectMeld,
  canAdd = false,
}: Props) {
  const teamMelds = melds.filter((m) => m.teamId === teamId);
  const team = teamId.toLowerCase();

  return (
    <section
      className={`melds melds--${team} ${isYours ? 'melds--yours' : 'melds--theirs'}`}
      aria-label={`${title} melds`}
    >
      <header className="melds__header">
        <h3>
          <span className={`pip pip--${team}`}>{initialsOf(title)}</span>
          <span className="melds__title">{title}</span>
          {isYours && <span className="melds__whose">your team</span>}
        </h3>
        <span className={`badge ${isOpened ? 'badge--open' : 'badge--closed'}`}>
          {isOpened ? 'Open' : 'Not open'}
        </span>
      </header>

      {teamMelds.length === 0 ? (
        <p className="melds__empty">
          {isOpened ? 'No melds yet.' : `Needs a clean run of ${openingRunMinimum}+ to open.`}
        </p>
      ) : (
        <div className="melds__list">
          {teamMelds.map((meld) => {
            const selected = selectableMeldId === meld.id;
            const selectable = canAdd && Boolean(onSelectMeld);
            const Wrapper = selectable ? 'button' : 'div';
            const summary = `${meld.type === 'RUN' ? 'Run' : 'Set'} of ${meld.cards.length}${
              meld.isBucharo ? `, ${meld.bucharoBonusAwarded === 'CLEAN' ? 'clean' : 'dirty'} Bucharo` : ''
            }`;

            return (
              <Wrapper
                key={meld.id}
                type={selectable ? 'button' : undefined}
                className={`meld ${selected ? 'is-selected' : ''} ${selectable ? 'meld--selectable' : ''}`}
                onClick={selectable ? () => onSelectMeld!(meld.id) : undefined}
                aria-pressed={selectable ? selected : undefined}
                aria-label={selectable ? `Add to this ${summary.toLowerCase()}` : undefined}
              >
                <div
                  className="meld__fan"
                  // Long melds slide further over each other; the floor in
                  // meldFan keeps every corner index readable.
                  style={{ '--fan-overlap': fanOverlapFor(meld.cards.length) } as React.CSSProperties}
                >
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
                  <span className="meld__type">{summary.split(',')[0]}</span>
                  {meld.isBucharo && (
                    <span
                      className={`ribbon ${
                        meld.bucharoBonusAwarded === 'CLEAN' ? 'ribbon--clean' : 'ribbon--dirty'
                      }`}
                    >
                      {meld.bucharoBonusAwarded === 'CLEAN' ? 'CLEAN +200' : 'DIRTY +100'}
                    </span>
                  )}
                  {!meld.isBucharo && !meld.isClean && <span className="meld__tag">wild</span>}
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </section>
  );
}
