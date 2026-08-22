import type { MindiView } from '@bukharo/shared';

import type { CardFace } from '../../ui/cards';

/**
 * The handful of decisions the Mindi table needs to make about the player's
 * own hand. Kept apart from the components so they can be tested without a
 * DOM, and so the table never has to reason about rules inline.
 *
 * None of this is authority: the server decides every move. These only shape
 * what the interface offers, so a player is not invited to do the impossible.
 */

/** §11 — holding the suit that was led means you must play it. */
export function unplayableCardIds(view: MindiView): string[] {
  const hand = view.you?.hand ?? [];
  if (!view.you || view.currentPlayerId !== view.you.id) return hand.map((card) => card.id);
  if (view.status !== 'PLAYING') return hand.map((card) => card.id);

  const lead = view.currentTrick.leadSuit;
  if (lead) {
    const following = hand.filter((card) => card.suit === lead);
    if (following.length > 0) {
      return hand.filter((card) => card.suit !== lead).map((card) => card.id);
    }
  }

  // §22 — whoever called for the trump must then play that suit if they hold it.
  if (view.mustPlayTrumpBy === view.you.id && view.trumpSuit) {
    const trumps = hand.filter((card) => card.suit === view.trumpSuit);
    if (trumps.length > 0) {
      return hand.filter((card) => card.suit !== view.trumpSuit).map((card) => card.id);
    }
  }

  return [];
}

/** §17–18 — offered only to a player who cannot follow, and never to the hider. */
export function canRevealTrump(view: MindiView): boolean {
  if (!view.you || view.status !== 'PLAYING') return false;
  if (view.currentPlayerId !== view.you.id) return false;
  if (view.mode !== 'HIDDEN' || view.hiddenRevealed || !view.hiddenCardWaiting) return false;
  if (view.you.id === view.chooserId) return false;

  const lead = view.currentTrick.leadSuit;
  if (!lead) return false;
  return !view.you.hand.some((card) => card.suit === lead);
}

export function isYourTurn(view: MindiView): boolean {
  return Boolean(view.you) && view.currentPlayerId === view.you!.id;
}

export function isChoosingMode(view: MindiView): boolean {
  return view.status === 'CHOOSING_MODE';
}

export function youAreChoosing(view: MindiView): boolean {
  return isChoosingMode(view) && view.you?.id === view.chooserId;
}

/** What to say about trump, in one line. */
export function trumpSummary(view: MindiView): string {
  if (view.mode === null) return 'Trump not settled yet';
  if (view.trumpSuit) return `${view.trumpSuit} are trump`;
  if (view.mode === 'HIDDEN') return 'A card is face down — nobody has called for it';
  return 'Katte — the first card off suit will set trump';
}

/**
 * The trick to show in the middle: the one being played, or the one just
 * finished so the table can see who took it before it clears.
 */
export function trickOnDisplay(view: MindiView): {
  plays: Array<{ playerId: string; card: CardFace }>;
  winnerPlayerId: string | null;
  finished: boolean;
} {
  if (view.currentTrick.plays.length > 0) {
    return { plays: view.currentTrick.plays, winnerPlayerId: null, finished: false };
  }
  if (view.lastTrick) {
    return {
      plays: view.lastTrick.plays,
      winnerPlayerId: view.lastTrick.winnerPlayerId,
      finished: true,
    };
  }
  return { plays: [], winnerPlayerId: null, finished: false };
}
