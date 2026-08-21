/**
 * House rules.
 *
 * Every answer the rulebook gave that could plausibly differ at another table
 * lives here rather than being welded into the engine, the same approach that
 * has already paid for itself in Bukharo.
 */
export interface MindiRules {
  /** §84 — a team reaching this many Kot loses the match. */
  kotTarget: number;

  /**
   * Whether a trump revealed mid-trick promotes cards already on the table.
   * Confirmed false: a card of that suit played before the declaration stays
   * an ordinary card.
   */
  trumpAppliesRetroactively: boolean;

  /**
   * Whether the hidden card is drawn at random from the chooser's hand rather
   * than picked by them. Confirmed random.
   */
  hiddenCardChosenRandomly: boolean;

  /** §18 — the player who hid the card cannot call for its reveal. */
  chooserMayRevealOwnCard: boolean;

  /** Whether a void player holding trump is obliged to play it. Confirmed no. */
  mustTrumpWhenVoid: boolean;
}

export const DEFAULT_MINDI_RULES: MindiRules = {
  kotTarget: 3,
  trumpAppliesRetroactively: false,
  hiddenCardChosenRandomly: true,
  chooserMayRevealOwnCard: false,
  mustTrumpWhenVoid: false,
};

export function withMindiRules(overrides: Partial<MindiRules> = {}): MindiRules {
  return { ...DEFAULT_MINDI_RULES, ...overrides };
}

export const MINDI_PLAYER_COUNTS = [4, 6, 8];
