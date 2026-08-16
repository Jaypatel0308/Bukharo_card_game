interface Props {
  discardCount: number;
  meldLabel: string;
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
        <button type="button" className="button" disabled={!canMeld} onClick={onMeld}>
          {meldLabel}
        </button>
        <button type="button" className="button" disabled={!canAddToMeld} onClick={onAddToMeld}>
          Add to meld
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
