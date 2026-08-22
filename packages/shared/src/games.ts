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
