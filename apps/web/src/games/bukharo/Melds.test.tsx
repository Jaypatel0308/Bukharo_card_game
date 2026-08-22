import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDeck } from '@bukharo/game-engine';
import type { Card, Meld, MeldCard, NaturalRank, Suit, TeamId } from '@bukharo/game-engine';

import { Melds } from './Melds';
import { fanOverlapFor } from './meldFan';

afterEach(cleanup);

const DECK = createDeck();
const card = (rank: NaturalRank, suit: Suit): Card =>
  DECK.find((c) => c.rank === rank && c.suit === suit && c.deckNumber === 1)!;
const joker = DECK.find((c) => c.isJoker)!;

function meldOf(cards: Card[], overrides: Partial<Meld> = {}): Meld {
  const meldCards: MeldCard[] = cards.map((c) => ({
    card: c,
    role: c.isJoker ? 'WILD' : 'NATURAL',
    representedRank: (c.isJoker ? '9' : c.rank) as NaturalRank,
    representedSuit: c.isJoker ? 'spades' : c.suit,
  }));
  return {
    id: `meld_${cards.map((c) => c.id).join('_')}`,
    teamId: 'TEAM_A' as TeamId,
    type: 'RUN',
    cards: meldCards,
    isClean: !cards.some((c) => c.isJoker),
    isBucharo: cards.length >= 7,
    bucharoBonusAwarded: cards.length >= 7 ? (cards.some((c) => c.isJoker) ? 'DIRTY' : 'CLEAN') : 'NONE',
    createdByPlayerId: 'p1',
    isOpeningMeld: false,
    ...overrides,
  };
}

const RUN = meldOf([card('5', 'spades'), card('6', 'spades'), card('7', 'spades')]);

const BASE = {
  teamId: 'TEAM_A' as TeamId,
  title: 'Rockets',
  isOpened: true,
  wildRank: null,
  openingRunMinimum: 4,
};

describe('Melds', () => {
  it('shows only its own team’s melds', () => {
    const theirs = meldOf([card('2', 'hearts'), card('3', 'hearts'), card('4', 'hearts')], {
      teamId: 'TEAM_B',
    });
    render(<Melds {...BASE} melds={[RUN, theirs]} />);

    expect(screen.getByRole('img', { name: '5 of spades' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '2 of hearts' })).toBeNull();
  });

  it('renders every card of a fan, not just the visible sliver', () => {
    // The overlap is visual; each card must still be present and labelled.
    render(<Melds {...BASE} melds={[RUN]} />);
    for (const name of ['5 of spades', '6 of spades', '7 of spades']) {
      expect(screen.getByRole('img', { name })).toBeTruthy();
    }
  });

  it('says what a wild card is standing in for', () => {
    const dirty = meldOf([card('5', 'spades'), joker, card('7', 'spades')]);
    render(<Melds {...BASE} melds={[dirty]} />);
    expect(screen.getByRole('img', { name: /Joker.*playing as 9/ })).toBeTruthy();
  });

  it('lays several melds out side by side', () => {
    const second = meldOf([card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs')]);
    const { container } = render(<Melds {...BASE} melds={[RUN, second]} />);
    expect(container.querySelectorAll('.meld')).toHaveLength(2);
    expect(container.querySelectorAll('.meld__fan')).toHaveLength(2);
  });

  it('compresses a long fan more than a short one', () => {
    const short = meldOf([card('5', 'spades'), card('6', 'spades'), card('7', 'spades')]);
    const long = meldOf([
      card('4', 'hearts'), card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
      card('8', 'hearts'), card('9', 'hearts'), card('10', 'hearts'), card('J', 'hearts'),
      card('Q', 'hearts'), card('K', 'hearts'),
    ]);
    const { container } = render(<Melds {...BASE} melds={[short, long]} />);

    const fans = [...container.querySelectorAll('.meld__fan')] as HTMLElement[];
    const overlaps = fans.map((el) => Number(el.style.getPropertyValue('--fan-overlap')));
    expect(overlaps[0]).toBe(fanOverlapFor(3));
    expect(overlaps[1]).toBe(fanOverlapFor(10));
    expect(overlaps[1]).toBeGreaterThan(overlaps[0]!);
  });

  it('badges a clean Bucharo with its bonus', () => {
    const bucharo = meldOf([
      card('4', 'spades'), card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
      card('8', 'spades'), card('9', 'spades'), card('10', 'spades'),
    ]);
    render(<Melds {...BASE} melds={[bucharo]} />);
    expect(screen.getByText('CLEAN +200')).toBeTruthy();
  });

  it('is inert until the player may add to it', () => {
    render(<Melds {...BASE} melds={[RUN]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes selectable when the player may add to it', () => {
    const onSelectMeld = vi.fn();
    render(<Melds {...BASE} melds={[RUN]} canAdd onSelectMeld={onSelectMeld} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onSelectMeld).toHaveBeenCalledWith(RUN.id);
  });

  it('marks the chosen meld as pressed', () => {
    render(<Melds {...BASE} melds={[RUN]} canAdd onSelectMeld={vi.fn()} selectableMeldId={RUN.id} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('tells a closed team what it needs to open', () => {
    render(<Melds {...BASE} melds={[]} isOpened={false} openingRunMinimum={4} />);
    expect(screen.getByText(/clean run of 4\+/)).toBeTruthy();
    expect(screen.getByText('Not open')).toBeTruthy();
  });

  it('marks your own team’s side of the table', () => {
    const { container, rerender } = render(<Melds {...BASE} melds={[RUN]} isYours />);
    expect(container.querySelector('.melds--yours')).toBeTruthy();
    expect(screen.getByText('your team')).toBeTruthy();

    rerender(<Melds {...BASE} melds={[RUN]} />);
    expect(container.querySelector('.melds--theirs')).toBeTruthy();
    expect(screen.queryByText('your team')).toBeNull();
  });
});
