import type { WildAssignment } from '@bukharo/shared';

import { SUIT_SYMBOL } from '../../ui/cards';

interface Props {
  options: WildAssignment[][];
  /** The rank that is wild this round, so the plain reading can be named. */
  wildRank: string | null;
  onChoose(assignments: WildAssignment[]): void;
  onCancel(): void;
}

/**
 * What a reading does with the wild cards, in words.
 *
 * The reading where nothing is wild carries no assignments at all, so it used
 * to render as an empty button — the option to play a wild-rank card at its
 * face value was on screen the whole time, unlabelled and unrecognisable.
 */
function describe(assignments: WildAssignment[], wildRank: string | null): string {
  if (assignments.length === 0) {
    return wildRank
      ? `Nothing wild — the ${wildRank} counts as an ordinary ${wildRank}`
      : 'Nothing wild — every card at its face value';
  }
  const parts = assignments.map(
    (a) => `${a.representedRank}${a.representedSuit ? SUIT_SYMBOL[a.representedSuit] : ''}`,
  );
  return `Wild as ${parts.join(' + ')}`;
}

/** §43 — only shown when the server found more than one legal reading. */
export function WildChooser({ options, wildRank, onChoose, onCancel }: Props) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Choose what your wild card represents">
      <div className="modal__body">
        <h2>What should your wild card be?</h2>
        <p>That meld works more than one way. Pick the one you meant.</p>
        <div className="chooser">
          {options.map((assignments, index) => (
            <button
              key={index}
              type="button"
              className="button button--primary chooser__option"
              onClick={() => onChoose(assignments)}
            >
              {describe(assignments, wildRank)}
            </button>
          ))}
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
