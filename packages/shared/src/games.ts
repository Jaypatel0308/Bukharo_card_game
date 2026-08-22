/**
 * The catalogue of games this server can host.
 *
 * A descriptor holds only what the *room* needs to know: how many people may
 * sit down, when a match may begin, and what to call each position. Nothing
 * about cards, turns or scoring belongs here — those stay sealed inside each
 * game's own engine, which the room layer never reads.
 *
 * Adding a game means adding an entry here and an engine package. Nothing in
 * the room, session, presence or persistence code changes.
 */

export type GameId = 'bukharo' | 'mindi';

export interface GameDescriptor {
  id: GameId;
  name: string;
  /** One line, shown on the game picker. */
  tagline: string;
  /** Nobody may join beyond this. */
  maxPlayers: number;
  /**
   * Player counts a match may actually start with, ascending. Mindi will list
   * 4, 6 and 8; a room holding 5 simply cannot begin.
   */
  startCounts: number[];
  /** Display name for a position at the table, e.g. "North" or "Seat 3". */
  seatLabel(position: number, playerCount: number): string;

  /**
   * Both games are played to a single number, so the protocol carries one
   * `target` and each game says what it means.
   */
  targetLabel: string;
  targetHint: string;
  targetOptions: number[];
  defaultTarget: number;
  /**
   * How many players, in words, for the picker — the start counts read as
   * numbers and "4 / 6 / 8" needs saying rather than showing.
   */
  playerSummary: string;
  /**
   * The short "how it works" list. It lives here so no screen has to hardcode
   * one game's rules while the player is setting up the other.
   */
  rules: string[];
  /** True once the client can actually draw this game's table. */
  hasTable: boolean;
}

const COMPASS = ['North', 'East', 'South', 'West'];

export const GAMES: Record<GameId, GameDescriptor> = {
  bukharo: {
    id: 'bukharo',
    name: 'Bukharo',
    tagline: 'Four players, two teams, and a long argument about wild cards.',
    maxPlayers: 4,
    startCounts: [4],
    seatLabel: (position) => COMPASS[position] ?? `Seat ${position + 1}`,
    targetLabel: 'Play to',
    targetHint: 'The first team past this score wins the match.',
    targetOptions: [1000, 1500, 2000, 3000],
    defaultTarget: 2000,
    playerSummary: '4 players, 2 teams',
    rules: [
      'Two decks and four jokers. Everyone gets 13 cards.',
      'One card from the middle of the stock sets the wild rank for the round.',
      'Your team opens with a clean run of 4+ cards in one suit — no wilds. After that either partner can meld freely.',
      'Take the whole discard pile any time on your turn. No qualification needed.',
      '7+ cards in a meld is a Bucharo: +200 clean, +100 dirty.',
      'Empty your hand and you collect the 13-card Bucharoo for +100.',
      'Go out by discarding your last card for +100.',
    ],
    hasTable: true,
  },
  mindi: {
    id: 'mindi',
    name: 'Mindi',
    tagline: 'Trick taking in teams. Capture the tens; a clean sweep is a Kot.',
    maxPlayers: 8,
    startCounts: [4, 6, 8],
    seatLabel: (position) => `Seat ${position + 1}`,
    targetLabel: 'Kot to lose',
    targetHint: 'A team reaching this many Kot loses the match.',
    targetOptions: [1, 2, 3, 5],
    defaultTarget: 3,
    playerSummary: '4, 6 or 8 players, 2 teams',
    rules: [
      'Partners sit alternately, so the player either side of you is an opponent.',
      'Every ten is a Mindi. Win the trick holding one and it counts for your team.',
      'Follow the suit that was led if you can. If you cannot, play anything.',
      'The first player chooses: hide a card face down, or call Katte.',
      'A hidden card only becomes trump when someone who cannot follow calls for it.',
      'Under Katte the first card played off suit sets the trump instead.',
      'Most Mindis wins the hand; level on Mindis, it goes on tricks.',
      'Take every Mindi and it is a Kot. Reach the Kot limit and your team loses the match.',
    ],
    hasTable: true,
  },
};

export const GAME_IDS = Object.keys(GAMES) as GameId[];
export const DEFAULT_GAME: GameId = 'bukharo';

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && value in GAMES;
}

export function describeGame(id: GameId): GameDescriptor {
  return GAMES[id];
}

/**
 * Teams alternate around the table, so a position's team is simply whether it
 * is even or odd. That holds for four, six and eight players alike, and keeps
 * the two sides equal without anyone having to arrange it.
 */
export function teamForPosition(position: number): 'TEAM_A' | 'TEAM_B' {
  return position % 2 === 0 ? 'TEAM_A' : 'TEAM_B';
}

/** Why a match cannot start yet, or null when it can. */
export function clampTarget(game: GameDescriptor, value: number): number {
  if (!Number.isFinite(value)) return game.defaultTarget;
  const rounded = Math.round(value);
  const lowest = Math.min(...game.targetOptions);
  const highest = Math.max(...game.targetOptions);
  return Math.min(highest, Math.max(lowest, rounded));
}

export function whyCannotStart(game: GameDescriptor, seated: number): string | null {
  if (game.startCounts.includes(seated)) return null;

  const larger = game.startCounts.filter((count) => count > seated);
  if (larger.length === 0) {
    return `${game.name} seats at most ${game.maxPlayers} players.`;
  }

  const counts = game.startCounts.join(', ').replace(/, (\d+)$/, ' or $1');

  // With one legal size there is nothing to choose between, so say the plain
  // thing. With several, name each option and what it would take.
  if (game.startCounts.length === 1) {
    const more = larger[0]! - seated;
    return `${game.name} needs ${counts} players. You have ${seated} — ${more} more to go.`;
  }

  const needs = larger.map((count) => `${count - seated} more to play ${count}`).join(', or ');
  return `${game.name} needs ${counts} players. You have ${seated} — ${needs}.`;
}
