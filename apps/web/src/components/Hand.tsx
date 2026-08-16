import { useEffect, useRef, useState } from 'react';
import type { Card, NaturalRank } from '@bukharo/game-engine';

import { PlayingCard } from './PlayingCard';
import { compareCards, sortHand, type SortMode } from '../ui/cards';

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

  // Cards arriving from a draw or from taking the discard pile are put where
  // they belong rather than dumped at the end. A hand the player has not
  // rearranged by hand simply stays sorted; once they have dragged cards about,
  // their arrangement is preserved and new cards slot into it.
  useEffect(() => {
    const ids = cards.map((c) => c.id);
    const previous = previousIds.current;
    previousIds.current = new Set(ids);

    // A card is "just picked up" only when it joins a hand that already had
    // cards. A wholesale replacement is a fresh deal, a new round, the Bucharoo
    // or a reconnect — highlighting all thirteen would be noise.
    const arrivals = cards.filter((c) => !previous.has(c.id));
    if (arrivals.length > 0) {
      setJustPickedUp(arrivals.length === cards.length ? [] : arrivals.map((c) => c.id));
    }

    setOrder((current) => {
      const present = new Set(ids);
      const kept = current.filter((id) => present.has(id));

      if (!manualOrder) return sortHand(cards, sortMode).map((c) => c.id);

      const known = new Set(kept);
      const arrived = sortHand(
        cards.filter((c) => !known.has(c.id)),
        sortMode,
      );
      if (arrived.length === 0) return kept;

      const compare = compareCards(sortMode);
      const byId = new Map(cards.map((c) => [c.id, c]));
      const next = [...kept];
      for (const card of arrived) {
        const at = next.findIndex((id) => {
          const existing = byId.get(id);
          return existing ? compare(card, existing) < 0 : false;
        });
        if (at === -1) next.push(card.id);
        else next.splice(at, 0, card.id);
      }
      return next;
      // sortMode is deliberately not a dependency: changing it is an explicit
      // action handled by applySort, not something a re-render should trigger.
    });
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
    setOrder((current) => {
      const at = current.indexOf(state.id);
      if (at === -1 || at === target) return current;
      const next = [...current];
      next.splice(at, 1);
      next.splice(target, 0, state.id);
      return next;
    });
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
