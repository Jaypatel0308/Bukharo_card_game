import { NATURAL_RANKS, isWildCard, ordinalToRank } from './cards.js';
import type { RuleConfig } from './rules.js';
import type {
  Card,
  EngineErrorCode,
  MeldCard,
  MeldType,
  NaturalRank,
  Suit,
  WildAssignment,
} from './types.js';

export interface MeldResolution {
  type: MeldType;
  /** Runs are ordered low → high; sets keep natural-cards-first ordering. */
  cards: MeldCard[];
  isClean: boolean;
}

export type MeldValidation =
  | { ok: true; resolutions: MeldResolution[] }
  | { ok: false; code: EngineErrorCode; message: string };

export interface MeldContext {
  wildRank: NaturalRank | null;
  rules: RuleConfig;
}

/** Distinct interpretations we are willing to offer a player at once. */
const MAX_RESOLUTIONS = 12;

function wildable(card: Card, ctx: MeldContext): boolean {
  return isWildCard(card, ctx.wildRank, {
    jokersAreWild: ctx.rules.jokersAreWild,
    roundWildEnabled: ctx.rules.roundWildEnabled,
  });
}

/**
 * A wild-rank card (say a 6 when 6s are wild) can potentially be played as a
 * plain 6. Jokers never can.
 */
function canBeNatural(card: Card, ctx: MeldContext): boolean {
  if (card.isJoker) return false;
  if (!wildable(card, ctx)) return true;
  return ctx.rules.wildRankCardCanBeUsedNaturally;
}

/** Every natural/wild split the caller could choose for the flexible cards. */
function roleCombinations(cards: Card[], ctx: MeldContext): Array<Map<string, 'NATURAL' | 'WILD'>> {
  const flexible: Card[] = [];
  const fixed = new Map<string, 'NATURAL' | 'WILD'>();

  for (const card of cards) {
    const isWild = wildable(card, ctx);
    const naturalOk = canBeNatural(card, ctx);
    if (isWild && naturalOk) flexible.push(card);
    else fixed.set(card.id, isWild ? 'WILD' : 'NATURAL');
  }

  // 2^n over flexible cards; in practice n is tiny (a couple of wild-rank cards).
  const capped = flexible.slice(0, 10);
  for (const extra of flexible.slice(10)) fixed.set(extra.id, 'WILD');

  const combos: Array<Map<string, 'NATURAL' | 'WILD'>> = [];
  const total = 1 << capped.length;
  for (let mask = 0; mask < total; mask++) {
    const combo = new Map(fixed);
    capped.forEach((card, index) => {
      combo.set(card.id, (mask & (1 << index)) !== 0 ? 'NATURAL' : 'WILD');
    });
    combos.push(combo);
  }
  return combos;
}

function checkWildLimits(cards: MeldCard[], rules: RuleConfig): boolean {
  const wilds = cards.filter((c) => c.role === 'WILD').length;
  const naturals = cards.length - wilds;
  if (rules.maxWildsPerMeld !== null && wilds > rules.maxWildsPerMeld) return false;
  if (rules.wildsMustNotOutnumberNaturals && wilds > naturals) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Sets                                                                */
/* ------------------------------------------------------------------ */

export function validateSet(cards: Card[], ctx: MeldContext): MeldValidation {
  const { rules } = ctx;
  if (cards.length < rules.normalMeldMinimum) {
    return {
      ok: false,
      code: 'MELD_TOO_SMALL',
      message: `A set must contain at least ${rules.normalMeldMinimum} cards.`,
    };
  }
  if (rules.maxSetSize !== null && cards.length > rules.maxSetSize) {
    return {
      ok: false,
      code: 'INVALID_SET',
      message: `A set may contain at most ${rules.maxSetSize} cards.`,
    };
  }

  const resolutions: MeldResolution[] = [];
  const seen = new Set<string>();

  // The target rank can only be a rank actually present on a non-joker card.
  const candidateRanks = new Set<NaturalRank>();
  for (const card of cards) {
    if (!card.isJoker) candidateRanks.add(card.rank as NaturalRank);
  }

  for (const targetRank of candidateRanks) {
    const meldCards: MeldCard[] = [];
    let valid = true;
    const naturalKeys = new Set<string>();

    for (const card of cards) {
      const isTarget = !card.isJoker && card.rank === targetRank;
      // A wild-rank card matching the target rank is natural only if allowed.
      if (isTarget && canBeNatural(card, ctx)) {
        const key = `${card.rank}-${card.suit}`;
        if (!rules.allowDuplicateCardsInSet && naturalKeys.has(key)) {
          valid = false;
          break;
        }
        naturalKeys.add(key);
        meldCards.push({ card, role: 'NATURAL', representedRank: targetRank, representedSuit: null });
      } else if (wildable(card, ctx)) {
        meldCards.push({ card, role: 'WILD', representedRank: targetRank, representedSuit: null });
      } else {
        valid = false;
        break;
      }
    }

    if (!valid || !checkWildLimits(meldCards, rules)) continue;
    if (!meldCards.some((c) => c.role === 'NATURAL')) continue;

    const signature = signatureOf('SET', meldCards);
    if (seen.has(signature)) continue;
    seen.add(signature);
    resolutions.push({
      type: 'SET',
      cards: [...meldCards].sort((a, b) => Number(b.role === 'NATURAL') - Number(a.role === 'NATURAL')),
      isClean: meldCards.every((c) => c.role === 'NATURAL'),
    });
  }

  if (resolutions.length === 0) {
    return {
      ok: false,
      code: 'INVALID_SET',
      message: 'A set must be three or more cards of the same rank, with wild cards standing in for the rest.',
    };
  }
  return { ok: true, resolutions: resolutions.slice(0, MAX_RESOLUTIONS) };
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Every ordered rank window a run of `length` cards could occupy.
 * Positions 1..14 place the ace low (1) and high (14); a window may not
 * contain both, which is what keeps A-K-A out of the game.
 */
function runWindows(length: number, rules: RuleConfig): NaturalRank[][] {
  const windows: NaturalRank[][] = [];
  if (length > 13) return windows;

  for (let start = 1; start + length - 1 <= 14; start++) {
    const end = start + length - 1;
    if (start === 1 && !rules.aceLowInRuns) continue;
    if (end === 14 && !rules.aceHighInRuns) continue;
    if (start === 1 && end === 14) continue; // would use the ace twice
    const window: NaturalRank[] = [];
    for (let ordinal = start; ordinal <= end; ordinal++) {
      const rank = ordinalToRank(ordinal);
      if (!rank) break;
      window.push(rank);
    }
    if (window.length === length) windows.push(window);
  }

  if (rules.runsWrapAround && length < 13) {
    // Circular universe A,2,...,K with K adjacent to A: adds K-A-2 style runs.
    const circle: NaturalRank[] = ['A', ...NATURAL_RANKS.filter((r) => r !== 'A')];
    for (let start = 0; start < circle.length; start++) {
      if (start + length <= circle.length) continue; // already covered above
      const window: NaturalRank[] = [];
      for (let offset = 0; offset < length; offset++) {
        window.push(circle[(start + offset) % circle.length]!);
      }
      windows.push(window);
    }
  }

  return windows;
}

export function validateRun(cards: Card[], ctx: MeldContext): MeldValidation {
  const { rules } = ctx;
  if (cards.length < rules.normalMeldMinimum) {
    return {
      ok: false,
      code: 'MELD_TOO_SMALL',
      message: `A run must contain at least ${rules.normalMeldMinimum} cards.`,
    };
  }
  if (cards.length > 13) {
    return {
      ok: false,
      code: 'INVALID_RUN',
      message: 'A run cannot be longer than 13 cards.',
    };
  }

  const resolutions: MeldResolution[] = [];
  const seen = new Set<string>();
  const windows = runWindows(cards.length, rules);
  let sawMixedSuits = false;
  let sawDuplicateRank = false;

  for (const combo of roleCombinations(cards, ctx)) {
    const naturals = cards.filter((c) => combo.get(c.id) === 'NATURAL');
    const wilds = cards.filter((c) => combo.get(c.id) === 'WILD');
    if (naturals.length === 0) continue;

    const suits = new Set(naturals.map((c) => c.suit));
    if (suits.size > 1) {
      sawMixedSuits = true;
      continue;
    }
    const suit = naturals[0]!.suit as Suit;

    const rankCounts = new Map<NaturalRank, number>();
    for (const card of naturals) {
      const rank = card.rank as NaturalRank;
      rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
    }
    if ([...rankCounts.values()].some((count) => count > 1)) {
      sawDuplicateRank = true;
      continue;
    }

    for (const window of windows) {
      const slots: Array<Card | null> = window.map(() => null);
      let fits = true;

      for (const card of naturals) {
        const index = window.findIndex((rank, i) => rank === card.rank && slots[i] === null);
        if (index === -1) {
          fits = false;
          break;
        }
        slots[index] = card;
      }
      if (!fits) continue;

      const emptySlots = slots.filter((slot) => slot === null).length;
      if (emptySlots !== wilds.length) continue;

      const wildQueue = [...wilds];
      const meldCards: MeldCard[] = window.map((rank, i) => {
        const natural = slots[i];
        if (natural) {
          return { card: natural, role: 'NATURAL' as const, representedRank: rank, representedSuit: suit };
        }
        return {
          card: wildQueue.shift()!,
          role: 'WILD' as const,
          representedRank: rank,
          representedSuit: suit,
        };
      });

      if (!checkWildLimits(meldCards, rules)) continue;

      const signature = signatureOf('RUN', meldCards);
      if (seen.has(signature)) continue;
      seen.add(signature);
      resolutions.push({
        type: 'RUN',
        cards: meldCards,
        isClean: meldCards.every((c) => c.role === 'NATURAL'),
      });
      if (resolutions.length >= MAX_RESOLUTIONS) break;
    }
    if (resolutions.length >= MAX_RESOLUTIONS) break;
  }

  if (resolutions.length === 0) {
    if (sawMixedSuits) {
      return {
        ok: false,
        code: 'INVALID_RUN',
        message: 'This run is not valid because all cards must have the same suit.',
      };
    }
    if (sawDuplicateRank) {
      return {
        ok: false,
        code: 'INVALID_RUN',
        message: 'This run is not valid because it repeats the same card rank.',
      };
    }
    return {
      ok: false,
      code: 'INVALID_RUN',
      message: 'These cards do not form a run of consecutive cards in one suit.',
    };
  }
  return { ok: true, resolutions };
}

/* ------------------------------------------------------------------ */
/* Combined validation                                                 */
/* ------------------------------------------------------------------ */

export function validateMeld(
  cards: Card[],
  ctx: MeldContext,
  requestedType?: MeldType,
): MeldValidation {
  if (requestedType === 'SET') return validateSet(cards, ctx);
  if (requestedType === 'RUN') return validateRun(cards, ctx);

  const asSet = validateSet(cards, ctx);
  const asRun = validateRun(cards, ctx);

  if (asSet.ok && asRun.ok) {
    return { ok: true, resolutions: [...asSet.resolutions, ...asRun.resolutions].slice(0, MAX_RESOLUTIONS) };
  }
  if (asSet.ok) return asSet;
  if (asRun.ok) return asRun;

  // Neither worked — surface whichever error is likelier to be useful.
  const sameRank = new Set(cards.filter((c) => !c.isJoker).map((c) => c.rank)).size === 1;
  return sameRank ? asSet : asRun;
}

/**
 * §12 — the run that opens a team: a clean, same-suit, consecutive run of at
 * least `openingRunMinimum` cards, with no card used as a wild substitution.
 */
export function validateOpeningRun(cards: Card[], ctx: MeldContext): MeldValidation {
  const { rules } = ctx;
  if (cards.length < rules.openingRunMinimum) {
    return {
      ok: false,
      code: 'OPENING_REQUIREMENTS',
      message: `Your team must first open with a clean run of at least ${rules.openingRunMinimum} cards.`,
    };
  }

  const result = validateRun(cards, ctx);
  if (!result.ok) return result;

  const clean = rules.openingRunMustBeClean
    ? result.resolutions.filter((r) => r.isClean)
    : result.resolutions;

  if (clean.length === 0) {
    return {
      ok: false,
      code: 'OPENING_REQUIREMENTS',
      message: 'Your opening run must be clean — it cannot use jokers or wild cards as substitutes.',
    };
  }
  return { ok: true, resolutions: clean };
}

/* ------------------------------------------------------------------ */
/* Wild assignment selection                                           */
/* ------------------------------------------------------------------ */

function signatureOf(type: MeldType, cards: MeldCard[]): string {
  const parts = [...cards]
    .map((c) => `${c.card.id}:${c.role}:${c.representedRank}:${c.representedSuit ?? '-'}`)
    .sort();
  return `${type}|${parts.join(',')}`;
}

/** The wild interpretations a client would need to choose between. */
export function assignmentsOf(resolution: MeldResolution): WildAssignment[] {
  return resolution.cards
    .filter((c) => c.role === 'WILD')
    .map((c) => ({
      cardId: c.card.id,
      representedRank: c.representedRank,
      representedSuit: c.representedSuit,
    }));
}

function wildCount(resolution: MeldResolution): number {
  return resolution.cards.filter((c) => c.role === 'WILD').length;
}

function matchesAssignments(resolution: MeldResolution, assignments: WildAssignment[]): boolean {
  const actual = assignmentsOf(resolution);
  if (actual.length !== assignments.length) return false;
  return assignments.every((wanted) =>
    actual.some(
      (a) =>
        a.cardId === wanted.cardId &&
        a.representedRank === wanted.representedRank &&
        (wanted.representedSuit == null || a.representedSuit === wanted.representedSuit),
    ),
  );
}

/**
 * Picks the single resolution to commit.
 *
 * - one resolution → use it (§43: assign automatically);
 * - client supplied an explicit interpretation → honour it if it is legal;
 * - several genuinely different interpretations → ask the player to choose.
 *
 * Interpretations that differ only in *which* wild card sits in which slot are
 * not a real choice, so they are collapsed first.
 */
export function selectResolution(
  resolutions: MeldResolution[],
  assignments: WildAssignment[] | undefined,
): { ok: true; resolution: MeldResolution } | { ok: false; options: MeldResolution[] } {
  if (assignments && assignments.length > 0) {
    const match = resolutions.find((r) => matchesAssignments(r, assignments));
    if (match) return { ok: true, resolution: match };
  }

  // Two interpretations are only a real choice when they occupy *different*
  // slots. Interpretations covering the same slots differ merely in how many
  // cards act as wilds — and playing a wild-rank card at its face value is
  // never worse for the player, so the cleanest variant is chosen silently.
  const groups = new Map<string, MeldResolution>();
  for (const resolution of resolutions) {
    const key = [
      resolution.type,
      resolution.cards
        .map((c) => `${c.representedRank}:${c.representedSuit ?? '-'}`)
        .sort()
        .join(','),
    ].join('|');
    const current = groups.get(key);
    if (!current || wildCount(resolution) < wildCount(current)) {
      groups.set(key, resolution);
    }
  }

  const distinct = [...groups.values()];
  if (distinct.length === 1) return { ok: true, resolution: distinct[0]! };
  return { ok: false, options: distinct };
}
