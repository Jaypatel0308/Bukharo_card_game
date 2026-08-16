/**
 * How far each card in a meld fan slides over its neighbour, as a fraction of
 * a card's width.
 *
 * Long melds compress so a Bucharo still fits a phone, but never past the
 * point where the corner index stops being readable. The floor is set by the
 * widest index a card can carry — "10" — which needs roughly 38% of the card
 * width alongside its padding.
 */
export const MIN_VISIBLE = 0.38;
export const MAX_VISIBLE = 0.46;

export function fanVisibleFraction(cardCount: number): number {
  if (cardCount <= 5) return MAX_VISIBLE;
  if (cardCount <= 8) return 0.42;
  return MIN_VISIBLE;
}

/** The fraction hidden, which is what the negative margin needs. */
export function fanOverlapFor(cardCount: number): number {
  return Number((1 - fanVisibleFraction(cardCount)).toFixed(3));
}
