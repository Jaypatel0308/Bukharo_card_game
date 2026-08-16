import type { Card } from '@bukharo/game-engine';

import { compareCards, sortHand, type SortMode } from './cards';

export interface HandOrderInput {
  /** The hand as the server sees it. */
  cards: Card[];
  /** The order currently on screen, as card ids. */
  previousOrder: string[];
  /** True once the player has dragged a card, which pins their arrangement. */
  manualOrder: boolean;
  sortMode: SortMode;
}

/**
 * Works out where a hand's cards should sit after it changes.
 *
 * A hand the player has not rearranged simply stays sorted, so a drawn card
 * lands where it belongs rather than at the end. Once they have dragged cards
 * about, their arrangement is preserved and new cards slot into it by the
 * active sort.
 */
export function planHandOrder({
  cards,
  previousOrder,
  manualOrder,
  sortMode,
}: HandOrderInput): string[] {
  const present = new Set(cards.map((c) => c.id));
  const kept = previousOrder.filter((id) => present.has(id));

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
}

/**
 * Which cards should be highlighted as just picked up.
 *
 * Only cards joining a hand that already had some count. A wholesale
 * replacement is a fresh deal, a new round, the Bucharoo or a reconnect —
 * highlighting all thirteen would be noise, so it highlights none.
 */
export function pickedUpThisTurn(cards: Card[], previousIds: ReadonlySet<string>): string[] {
  const arrivals = cards.filter((c) => !previousIds.has(c.id));
  if (arrivals.length === 0 || arrivals.length === cards.length) return [];
  return arrivals.map((c) => c.id);
}

/** Where a dragged card should land, given the pointer position. */
export function reorderForDrag(order: string[], cardId: string, targetIndex: number): string[] {
  const from = order.indexOf(cardId);
  if (from === -1 || from === targetIndex || targetIndex < 0) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(targetIndex, 0, cardId);
  return next;
}
