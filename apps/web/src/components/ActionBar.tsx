interface Props {
  discardCount: number;
  meldLabel: string;
  /** The same action, worded to fit a phone. */
  meldLabelShort: string;
  canDraw: boolean;
  canMeld: boolean;
  canAddToMeld: boolean;
  canDiscard: boolean;
  hasSelection: boolean;
  onDraw(): void;
  onTakePile(): void;
  onSeePile(): void;
  onMeld(): void;
  onAddToMeld(): void;
  onDiscard(): void;
  onClear(): void;
}

/**
 * Every button keeps a fixed position and a fixed meaning, enabled or disabled
 * by the phase. An earlier version swapped the bar's contents between draw and
 * play, so a button could change identity under a waiting player's finger and a
 * tap meant for the meld button drew a card instead.
 */
export function ActionBar({
  discardCount,
  meldLabel,
  meldLabelShort,
  canDraw,
  canMeld,
  canAddToMeld,
  canDiscard,
  hasSelection,
  onDraw,
  onTakePile,
  onSeePile,
  onMeld,
  onAddToMeld,
  onDiscard,
  onClear,
}: Props) {
  return (
    <div className="actionbar">
      <div className="actionbar__row">
        <button type="button" className="button button--primary" disabled={!canDraw} onClick={onDraw}>
          Draw card
        </button>
        <button
          type="button"
          className="button"
          disabled={!canDraw || discardCount === 0}
          onClick={onTakePile}
        >
          Take pile ({discardCount})
        </button>
        <button type="button" className="button" disabled={discardCount === 0} onClick={onSeePile}>
          See pile
        </button>
      </div>

      <div className="actionbar__row">
        <button
          type="button"
          className="button"
          disabled={!canMeld}
          aria-label={meldLabel}
          onClick={onMeld}
        >
          <span className="actionbar__long">{meldLabel}</span>
          <span className="actionbar__short">{meldLabelShort}</span>
        </button>
        <button
          type="button"
          className="button"
          disabled={!canAddToMeld}
          aria-label="Add to meld"
          onClick={onAddToMeld}
        >
          <span className="actionbar__long">Add to meld</span>
          <span className="actionbar__short">Add</span>
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={!canDiscard}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button type="button" className="button button--ghost" disabled={!hasSelection} onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
