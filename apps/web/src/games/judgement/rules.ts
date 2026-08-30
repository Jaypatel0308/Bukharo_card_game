import type { JudgementView } from '@bukharo/shared';

/**
 * What the Judgement table needs to decide about the player's own hand.
 *
 * None of this is authority — the server settles every move. These only shape
 * what the interface offers, so nobody is invited to do the impossible.
 */

export function isYourTurn(view: JudgementView): boolean {
  return Boolean(view.you) && view.currentPlayerId === view.you!.id;
}

export function isBidding(view: JudgementView): boolean {
  return view.status === 'BIDDING';
}

export function youAreBidding(view: JudgementView): boolean {
  return isBidding(view) && isYourTurn(view);
}

/** §33 — cards you may not play because you can still follow suit. */
export function unplayableCardIds(view: JudgementView): string[] {
  const hand = view.you?.hand ?? [];
  if (!isYourTurn(view) || view.status !== 'PLAYING') return hand.map((c) => c.id);
  const legal = new Set(view.yourLegalCardIds);
  return hand.filter((card) => !legal.has(card.id)).map((card) => card.id);
}

/**
 * How this player stands against their own judgement — the only thing that
 * matters, and the thing a trick-count alone does not tell you.
 */
export function standingFor(
  view: JudgementView,
  playerId: string,
): 'unjudged' | 'needs-more' | 'exact' | 'overshot' {
  const player = view.players.find((p) => p.id === playerId);
  if (!player || player.bid === null) return 'unjudged';
  if (player.tricksWon < player.bid) return 'needs-more';
  if (player.tricksWon === player.bid) return 'exact';
  return 'overshot';
}

/** A short line saying where the bidding has got to (§27). */
export function biddingSummary(view: JudgementView): string {
  const judged = view.players.filter((p) => p.bid !== null).length;
  if (judged < view.players.length) {
    return `${view.bidsTotal} judged so far, ${judged} of ${view.players.length} in`;
  }
  const diff = view.bidsTotal - view.cardsEach;
  if (diff > 0) return `${view.bidsTotal} judged for ${view.cardsEach} — somebody must fall short`;
  return `${view.bidsTotal} judged for ${view.cardsEach} — somebody must take one too many`;
}

export function trumpLabel(suit: JudgementView['trump']): string {
  return { spades: '♠', diamonds: '♦', clubs: '♣', hearts: '♥' }[suit];
}
