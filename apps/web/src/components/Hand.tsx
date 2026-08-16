import { useEffect, useRef, useState } from 'react';
import type { Card, NaturalRank } from '@bukharo/game-engine';

import { PlayingCard } from './PlayingCard';
import { sortHand, type SortMode } from '../ui/cards';
import { pickedUpThisTurn, planHandOrder, reorderForDrag } from '../ui/handOrder';

interface Props {
  cards: Card[];
  wildRank: NaturalRank | null;
  selectedIds: string[];
  onToggle(cardId: string): void;
  disabled?: boolean;
}

/**
 * The player's hand. Tapping selects — that is the primary interaction on every
 * device (§41) — and cards can also be dragged into a preferred order (§37).
 */
export function Hand({ cards, wildRank, selectedIds, onToggle, disabled = false }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('suit');
  const [order, setOrder] = useState<string[]>([]);
  /** True once the player has dragged a card, which pins their arrangement. */
  const [manualOrder, setManualOrder] = useState(false);
  /** Cards that arrived this turn, highlighted until the turn is over. */
  const [justPickedUp, setJustPickedUp] = useState<string[]>([]);
  const previousIds = useRef<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; startX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  // Ordering and highlight rules live in ../ui/handOrder so they can be tested
  // without a DOM; this effect only feeds them the latest hand.
  useEffect(() => {
    const ids = cards.map((c) => c.id);
    const previous = previousIds.current;
    previousIds.current = new Set(ids);

    const arrivals = pickedUpThisTurn(cards, previous);
    if (arrivals.length > 0) setJustPickedUp(arrivals);

    setOrder((current) =>
      planHandOrder({ cards, previousOrder: current, manualOrder, sortMode }),
    );
    // sortMode is deliberately not a dependency: changing it is an explicit
    // action handled by applySort, not something a re-render should trigger.
  }, [cards, manualOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // The highlight answers "what did I just pick up?", so it lives exactly as
  // long as the turn does.
  useEffect(() => {
    if (disabled) setJustPickedUp([]);
  }, [disabled]);

  const byId = new Map(cards.map((c) => [c.id, c]));
  const ordered = order.map((id) => byId.get(id)).filter((c): c is Card => Boolean(c));
  const newCount = justPickedUp.filter((id) => byId.has(id)).length;

  const applySort = (mode: SortMode): void => {
    setSortMode(mode);
    setManualOrder(false);
    setOrder(sortHand(cards, mode).map((c) => c.id));
  };

  const indexFromPoint = (clientX: number): number | null => {
    const container = containerRef.current;
    if (!container) return null;
    const nodes = [...container.querySelectorAll<HTMLElement>('[data-card-id]')];
    for (let i = 0; i < nodes.length; i++) {
      const rect = nodes[i]!.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return nodes.length - 1;
  };

  const onPointerDown = (event: React.PointerEvent, cardId: string): void => {
    if (disabled) return;
    drag.current = { id: cardId, startX: event.clientX, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    const state = drag.current;
    if (!state) return;
    if (!state.moved && Math.abs(event.clientX - state.startX) < 10) return;
    state.moved = true;
    setDraggingId(state.id);

    const target = indexFromPoint(event.clientX);
    if (target === null) return;
    const from = order.indexOf(state.id);
    if (from === -1 || from === target) return;

    setManualOrder(true);
    setOrder((current) => reorderForDrag(current, state.id, target));
  };

  const endDrag = (): void => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
    setDraggingId(null);
  };

  return (
    <section className="hand" aria-label="Your hand">
      <div className="hand__toolbar">
        <span className="hand__count">
          {cards.length} card{cards.length === 1 ? '' : 's'}
          {newCount > 0 && <span className="hand__new"> · {newCount} just picked up</span>}
        </span>
        <div className="hand__sorts" role="group" aria-label="Sort your hand">
          {(['suit', 'rank', 'points'] as SortMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`chip ${sortMode === mode ? 'is-active' : ''}`}
              aria-pressed={sortMode === mode}
              onClick={() => applySort(mode)}
            >
              {mode === 'suit' ? 'Suit' : mode === 'rank' ? 'Rank' : 'Points'}
            </button>
          ))}
          {manualOrder && (
            <button type="button" className="chip" onClick={() => applySort(sortMode)}>
              Tidy up
            </button>
          )}
        </div>
      </div>

      <div
        className="hand__cards"
        ref={containerRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        {ordered.map((card) => (
          <div
            key={card.id}
            data-card-id={card.id}
            className={`hand__slot ${draggingId === card.id ? 'is-dragging' : ''}`}
            onPointerDown={(event) => onPointerDown(event, card.id)}
          >
            <PlayingCard
              card={card}
              wildRank={wildRank}
              selected={selectedIds.includes(card.id)}
              isNew={justPickedUp.includes(card.id)}
              disabled={disabled}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onToggle(card.id);
              }}
            />
          </div>
        ))}
        {ordered.length === 0 && <p className="hand__empty">No cards in hand.</p>}
      </div>
    </section>
  );
}
