import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateMeld, validateOpeningRun, validateRun, validateSet, selectResolution } from '../src/meld.js';
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
