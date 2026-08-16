import type { WildAssignment } from '@bukharo/shared';

import { SUIT_SYMBOL } from '../ui/cards';

interface Props {
  options: WildAssignment[][];
  onChoose(assignments: WildAssignment[]): void;
  onCancel(): void;
}

function describe(assignments: WildAssignment[]): string {
  return assignments
    .map((a) => `${a.representedRank}${a.representedSuit ? SUIT_SYMBOL[a.representedSuit] : ''}`)
    .join(' + ');
}

/** §43 — only shown when the server found more than one legal reading. */
export function WildChooser({ options, onChoose, onCancel }: Props) {
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
              {describe(assignments)}
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
