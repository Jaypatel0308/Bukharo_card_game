/**
 * Rule configuration.
 *
 * Every house rule lives here rather than being baked into the engine, because
 * the family's exact rules for several rare situations are still unconfirmed
 * (see §99 of the product spec). Each such rule is marked UNCONFIRMED below
 * with the default this build ships.
 */

export interface RuleConfig {
  /* Deal */
  cardsPerPlayer: number;
  bucharooSize: number;

  /* Opening */
  openingRunMinimum: number;
  openingRunMustBeClean: boolean;

  /* Melds */
  normalMeldMinimum: number;
  bucharoMinimumCards: number;
  /** null = unlimited. UNCONFIRMED (§99.4). */
  maxWildsPerMeld: number | null;
  /** Wilds may never outnumber naturals when true. UNCONFIRMED (§99.4). */
  wildsMustNotOutnumberNaturals: boolean;
  /** May two identical cards (one from each deck) sit in the same set? UNCONFIRMED (§99.13). */
  allowDuplicateCardsInSet: boolean;
  /** null = unlimited. UNCONFIRMED (§99.14). */
  maxSetSize: number | null;
  /** Cards already melded can be moved into another meld. UNCONFIRMED (§99.15). */
  allowRearrangingMeldedCards: boolean;

  /* Bonuses */
  cleanBucharoBonus: number;
  dirtyBucharoBonus: number;
  bucharooBonus: number;
  goingOutBonus: number;
  /** Keep the +200 once earned even if a wild is added later. UNCONFIRMED (§83/§99.3). */
  lockBucharoBonusOnCompletion: boolean;

  /* Discard pile */
  discardPickupRequiresQualification: boolean;
  discardPickupTakesEntirePile: boolean;

  /* Going out */
  lastCardMustBeDiscarded: boolean;
  /** The Bucharoo must already be gone before anyone may go out. UNCONFIRMED (§99.10/11). */
  bucharooMustBeTakenBeforeGoingOut: boolean;
  /** Team must own at least one Bucharo before going out. UNCONFIRMED (§99.11). */
  requireBucharoBeforeGoingOut: boolean;
  /** IMMEDIATE = pick the Bucharoo up and keep playing the same turn. UNCONFIRMED (§99.10). */
  bucharooPickupTiming: 'IMMEDIATE' | 'NEXT_TURN';
  /**
   * Collecting the Bucharoo by discarding the last card does not end the turn:
   * the player picks the thirteen cards up and carries on playing, finishing
   * the turn with a further discard from the new hand.
   */
  bucharooPickupContinuesTurn: boolean;

  /* Wilds */
  jokersAreWild: boolean;
  roundWildEnabled: boolean;
  /** A round-wild-rank card may be played as its face value, keeping a meld clean. UNCONFIRMED (§99.5). */
  wildRankCardCanBeUsedNaturally: boolean;
  /** What to do when the mid-stock reveal is a Joker. UNCONFIRMED (§99.2). */
  jokerWildRevealPolicy: 'REDRAW' | 'ACE_IS_WILD';

  /* Runs */
  /** A-2-3 permitted. UNCONFIRMED (§99.8). */
  aceLowInRuns: boolean;
  /** Q-K-A permitted. UNCONFIRMED (§99.7). */
  aceHighInRuns: boolean;
  /** K-A-2 permitted. UNCONFIRMED (§99.9). */
  runsWrapAround: boolean;

  /* Stock */
  /** UNCONFIRMED (§84). CONTINUE_WITH_DISCARD = keep playing off the discard pile. */
  stockExhaustionRule: 'CONTINUE_WITH_DISCARD' | 'END_ROUND_IMMEDIATELY';
  /**
   * Safety valve for CONTINUE_WITH_DISCARD. Once the stock is gone the discard
   * pile is never truly empty — whoever takes it must put one card back — so
   * without a limit a round in which nobody can go out runs forever. Play
   * continues for this many further laps of the table, then the round is scored
   * where it stands. UNCONFIRMED (§84): confirm the family's real rule.
   */
  lapsAfterStockExhausted: number;
  /** The revealed wild card is set aside as an indicator rather than discarded. */
  wildCardSetAside: boolean;

  /* Match */
  targetScore: number;
}

export const DEFAULT_RULES: RuleConfig = {
  cardsPerPlayer: 13,
  bucharooSize: 13,

  openingRunMinimum: 4,
  openingRunMustBeClean: true,

  normalMeldMinimum: 3,
  bucharoMinimumCards: 7,
  maxWildsPerMeld: null,
  wildsMustNotOutnumberNaturals: false,
  allowDuplicateCardsInSet: true,
  maxSetSize: null,
  allowRearrangingMeldedCards: false,

  cleanBucharoBonus: 200,
  dirtyBucharoBonus: 100,
  bucharooBonus: 100,
  goingOutBonus: 100,
  lockBucharoBonusOnCompletion: true,

  discardPickupRequiresQualification: false,
  discardPickupTakesEntirePile: true,

  lastCardMustBeDiscarded: true,
  bucharooMustBeTakenBeforeGoingOut: true,
  requireBucharoBeforeGoingOut: false,
  bucharooPickupTiming: 'IMMEDIATE',
  bucharooPickupContinuesTurn: true,

  jokersAreWild: true,
  roundWildEnabled: true,
  wildRankCardCanBeUsedNaturally: true,
  jokerWildRevealPolicy: 'REDRAW',

  aceLowInRuns: true,
  aceHighInRuns: true,
  runsWrapAround: false,

  stockExhaustionRule: 'CONTINUE_WITH_DISCARD',
  lapsAfterStockExhausted: 2,
  wildCardSetAside: true,

  targetScore: 2000,
};

export function withRules(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return { ...DEFAULT_RULES, ...overrides };
}
