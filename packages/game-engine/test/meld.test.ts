import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assignmentsOf,
  keepsPlacedWilds,
  selectResolution,
  validateMeld,
  validateOpeningRun,
  validateRun,
  validateSet,
} from '../src/meld.js';
import { card, joker, rules } from './helpers.js';

const ctx = (wildRank: Parameters<typeof card>[0] | null = '6') => ({
  wildRank,
  rules: rules(),
});

describe('opening run (§12)', () => {
  it('accepts a clean 4-card same-suit run', () => {
    const result = validateOpeningRun(
      [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')],
      ctx('K'),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.resolutions[0]!.isClean, true);
  });

  it('rejects a 3-card run as too short', () => {
    const result = validateOpeningRun(
      [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts')],
      ctx('K'),
    );
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /at least 4/);
  });

  it('rejects mixed suits', () => {
    const result = validateOpeningRun(
      [card('4', 'hearts'), card('5', 'diamonds'), card('6', 'hearts'), card('7', 'clubs')],
      ctx('K'),
    );
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /same suit/);
  });

  it('rejects a run that leans on a wild substitution', () => {
    const result = validateOpeningRun(
      [card('4', 'hearts'), card('5', 'hearts'), joker(), card('7', 'hearts')],
      ctx('K'),
    );
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /clean/);
  });

  it('accepts a longer clean run', () => {
    const result = validateOpeningRun(
      [
        card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
        card('J', 'spades'), card('Q', 'spades'),
      ],
      ctx('3'),
    );
    assert.equal(result.ok, true);
  });

  it('accepts a wild-rank card played at face value (rules.wildRankCardCanBeUsedNaturally)', () => {
    // 6s are wild this round, but 4-5-6-7 of hearts uses the 6 as a real 6.
    const result = validateOpeningRun(
      [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')],
      ctx('6'),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.resolutions.every((r) => r.isClean), true);
  });

  it('rejects the same run when face-value wilds are disallowed', () => {
    const result = validateOpeningRun(
      [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')],
      { wildRank: '6', rules: rules({ wildRankCardCanBeUsedNaturally: false }) },
    );
    assert.equal(result.ok, false);
  });
});

describe('sets (§14)', () => {
  it('accepts three of a kind', () => {
    const result = validateSet(
      [card('8', 'spades'), card('8', 'hearts'), card('8', 'diamonds')],
      ctx('K'),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.resolutions[0]!.isClean, true);
  });

  it('rejects two of a kind as too small', () => {
    const result = validateSet([card('8', 'spades'), card('8', 'hearts')], ctx('K'));
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'MELD_TOO_SMALL');
  });

  it('lets a joker complete a set (§11)', () => {
    const result = validateSet([card('K', 'spades'), card('K', 'diamonds'), joker()], ctx('3'));
    assert.equal(result.ok, true);
    const chosen = result.ok ? selectResolution(result.resolutions, undefined) : null;
    assert.equal(chosen?.ok, true);
    assert.equal(chosen?.ok && chosen.resolution.isClean, false);
  });

  it('lets the round wild rank complete a set', () => {
    const result = validateSet([card('K', 'spades'), card('K', 'diamonds'), card('6', 'clubs')], ctx('6'));
    assert.equal(result.ok, true);
  });

  it('rejects a set made only of wild cards', () => {
    const result = validateSet([joker(1), joker(2), joker(1, 2)], ctx('6'));
    assert.equal(result.ok, false);
  });

  it('allows the two identical cards from different decks in one set by default (§99.13)', () => {
    const result = validateSet(
      [card('8', 'spades', 1), card('8', 'spades', 2), card('8', 'hearts')],
      ctx('K'),
    );
    assert.equal(result.ok, true);
  });

  it('rejects duplicates when the house rule forbids them', () => {
    const result = validateSet(
      [card('8', 'spades', 1), card('8', 'spades', 2), card('8', 'hearts')],
      { wildRank: 'K', rules: rules({ allowDuplicateCardsInSet: false }) },
    );
    assert.equal(result.ok, false);
  });
});

describe('runs (§14)', () => {
  it('accepts a 3-card run', () => {
    const result = validateRun(
      [card('5', 'clubs'), card('6', 'clubs'), card('7', 'clubs')],
      ctx('K'),
    );
    assert.equal(result.ok, true);
  });

  it('lets a joker fill an interior gap', () => {
    const result = validateRun(
      [card('7', 'hearts'), card('8', 'hearts'), joker(), card('10', 'hearts')],
      ctx('K'),
    );
    assert.equal(result.ok, true);
    const resolution = result.ok ? result.resolutions[0]! : null;
    const wild = resolution?.cards.find((c) => c.role === 'WILD');
    assert.equal(wild?.representedRank, '9');
    assert.equal(wild?.representedSuit, 'hearts');
  });

  it('rejects a run with a repeated rank', () => {
    const result = validateRun(
      [card('7', 'hearts', 1), card('7', 'hearts', 2), card('8', 'hearts')],
      ctx('K'),
    );
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /repeats/);
  });

  it('offers both interpretations when a trailing wild is ambiguous (§43)', () => {
    const result = validateRun(
      [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'), joker()],
      ctx('K'),
    );
    assert.equal(result.ok, true);
    const chosen = result.ok ? selectResolution(result.resolutions, undefined) : null;
    assert.equal(chosen?.ok, false);
    assert.equal(chosen?.ok === false && chosen.options.length, 2);
  });

  it('honours an explicit wild assignment', () => {
    const result = validateRun(
      [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'), joker()],
      ctx('K'),
    );
    assert.equal(result.ok, true);
    const chosen = result.ok
      ? selectResolution(result.resolutions, [
          { cardId: joker().id, representedRank: '8', representedSuit: 'hearts' },
        ])
      : null;
    assert.equal(chosen?.ok, true);
    const wild = chosen?.ok ? chosen.resolution.cards.find((c) => c.role === 'WILD') : null;
    assert.equal(wild?.representedRank, '8');
  });

  it('prefers the clean reading when a wild-rank card also fits naturally', () => {
    const result = validateRun(
      [card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')],
      ctx('6'),
    );
    assert.equal(result.ok, true);
    const chosen = result.ok ? selectResolution(result.resolutions, undefined) : null;
    assert.equal(chosen?.ok, true);
    assert.equal(chosen?.ok && chosen.resolution.isClean, true);
  });

  it('allows A-2-3 and Q-K-A but not K-A-2 by default (§99.6-9)', () => {
    assert.equal(validateRun([card('A', 'spades'), card('2', 'spades'), card('3', 'spades')], ctx('K')).ok, true);
    assert.equal(validateRun([card('Q', 'spades'), card('K', 'spades'), card('A', 'spades')], ctx('3')).ok, true);
    assert.equal(validateRun([card('K', 'spades'), card('A', 'spades'), card('2', 'spades')], ctx('7')).ok, false);
  });

  it('allows K-A-2 when the wrap-around house rule is enabled', () => {
    const result = validateRun([card('K', 'spades'), card('A', 'spades'), card('2', 'spades')], {
      wildRank: '7',
      rules: rules({ runsWrapAround: true }),
    });
    assert.equal(result.ok, true);
  });

  it('respects a wild-count cap when configured', () => {
    const strict = { wildRank: 'K' as const, rules: rules({ maxWildsPerMeld: 1 }) };
    assert.equal(
      validateRun([card('5', 'hearts'), joker(1), joker(2), card('8', 'hearts')], strict).ok,
      false,
    );
  });
});

describe('meld type inference', () => {
  it('reads same-rank cards as a set', () => {
    const result = validateMeld([card('9', 'clubs'), card('9', 'hearts'), card('9', 'spades')], ctx('K'));
    assert.equal(result.ok && result.resolutions[0]!.type, 'SET');
  });

  it('reads consecutive same-suit cards as a run', () => {
    const result = validateMeld([card('9', 'clubs'), card('10', 'clubs'), card('J', 'clubs')], ctx('K'));
    assert.equal(result.ok && result.resolutions[0]!.type, 'RUN');
  });

  it('reports the suit problem for a broken run', () => {
    const result = validateMeld([card('9', 'clubs'), card('10', 'hearts'), card('J', 'clubs')], ctx('K'));
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /same suit|consecutive/);
  });
});

describe('a wild-rank card played at its face value (§99.5)', () => {
  const ctx = { wildRank: '10' as const, rules: rules() };

  it('offers the reading where nothing is wild', () => {
    // 8, 9 and a 10 of hearts, in a round where tens are wild.
    const cards = [card('8', 'hearts'), card('9', 'hearts'), card('10', 'hearts')];
    const result = validateRun(cards, ctx);
    assert.equal(result.ok, true);
    const clean = result.ok && result.resolutions.find((r) => r.isClean);
    assert.ok(clean, 'a clean 8-9-10 should be one of the readings');
  });

  it('lets the player actually choose it — an empty answer is an answer', () => {
    const cards = [card('8', 'hearts'), card('9', 'hearts'), card('10', 'hearts')];
    const result = validateRun(cards, ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // The reading with no wilds carries no assignments, so choosing it means
    // sending an empty list. Treating that as "no choice made" left it
    // impossible to pick, and the player was asked the same question forever.
    const chosen = selectResolution(result.resolutions, []);
    assert.equal(chosen.ok, true, 'the clean reading must be selectable');
    if (chosen.ok) {
      assert.equal(chosen.resolution.isClean, true);
      assert.deepEqual(
        chosen.resolution.cards.map((c) => `${c.representedRank}${c.role === 'WILD' ? '*' : ''}`),
        ['8', '9', '10'],
      );
    }
  });

  it('still asks, rather than guessing, when the readings really differ', () => {
    const cards = [card('8', 'hearts'), card('9', 'hearts'), card('10', 'hearts')];
    const result = validateRun(cards, ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Nothing chosen: 7-8-9 and 8-9-10 are genuinely different melds.
    const undecided = selectResolution(result.resolutions, undefined);
    assert.equal(undecided.ok, false, 'the player should be asked');
    if (!undecided.ok) {
      assert.equal(undecided.options.length, 2);
      // And one of the options offered is the empty one they can now pick.
      const empty = undecided.options.filter((o) => assignmentsOf(o).length === 0);
      assert.equal(empty.length, 1, 'the clean reading must be on the menu');
    }
  });

  it('extends a run with the wild rank as an ordinary card', () => {
    // 2 through 9 of diamonds, adding the 10 of diamonds as a real 10.
    const run = ['2', '3', '4', '5', '6', '7', '8', '9'].map((rank) =>
      card(rank as Parameters<typeof card>[0], 'diamonds'),
    );
    const result = validateRun([...run, card('10', 'diamonds')], ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const chosen = selectResolution(result.resolutions, []);
    assert.equal(chosen.ok, true);
    if (chosen.ok) {
      assert.equal(chosen.resolution.isClean, true, '2-10 with no wilds at all');
      assert.equal(chosen.resolution.cards.length, 9);
      assert.equal(chosen.resolution.cards.at(-1)!.representedRank, '10');
      assert.equal(chosen.resolution.cards.at(-1)!.role, 'NATURAL');
    }
  });
});

describe('a wild already lying in a meld stays where it was put', () => {
  it('keeps a 10 played as a 7 as a 7 when the run is extended', () => {
    const ctx = { wildRank: '10' as const, rules: rules() };
    // 7*, 8, 9 — the wild is standing in for the seven.
    const laid = validateRun(
      [card('10', 'clubs'), card('8', 'clubs'), card('9', 'clubs')],
      ctx,
    );
    assert.equal(laid.ok, true);
    if (!laid.ok) return;
    const asSeven = laid.resolutions.find(
      (r) => r.cards.some((c) => c.role === 'WILD' && c.representedRank === '7'),
    );
    assert.ok(asSeven, 'the wild can stand in for the seven');

    const placed = assignmentsOf(asSeven);
    assert.equal(placed.length, 1);
    assert.equal(placed[0]!.representedRank, '7');

    // Now a jack arrives. 8-9-10-J would also be a legal run, but only by
    // moving the wild from the seven to the ten, which is not the player's.
    const extended = validateRun(
      [...asSeven.cards.map((c) => c.card), card('J', 'clubs')],
      ctx,
    );
    assert.equal(extended.ok, true);
    if (!extended.ok) return;

    const faithful = extended.resolutions.filter((r) => keepsPlacedWilds(r, placed));
    for (const reading of faithful) {
      const wild = reading.cards.find((c) => c.role === 'WILD');
      assert.equal(wild?.representedRank, '7', 'the wild must still be the seven');
    }
    // And a reading that moved it is correctly rejected by the filter.
    const moved = extended.resolutions.filter((r) => !keepsPlacedWilds(r, placed));
    assert.ok(moved.length > 0, 'there was a tempting reading that moved it');
  });
});
