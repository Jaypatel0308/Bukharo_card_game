import { expect, type Browser, type Page } from '@playwright/test';

/** One player, in their own browser context so sessions do not collide. */
export interface Player {
  name: string;
  page: Page;
}

export async function openPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  return { name, page };
}

export async function createRoom(
  player: Player,
  target = '2,000',
  game = 'Bukharo',
): Promise<string> {
  // Hosting starts by choosing a game; the setup form is that game's own.
  await player.page.getByRole('button', { name: new RegExp(`^${game}`) }).click();
  await player.page.getByLabel('Your name').fill(player.name);
  await player.page.getByRole('button', { name: target, exact: true }).click();
  await player.page.getByRole('button', { name: 'Create room' }).click();

  const code = player.page.locator('.lobby__code');
  await expect(code).toBeVisible();
  return ((await code.textContent()) ?? '').trim();
}

export async function joinRoom(player: Player, code: string): Promise<void> {
  // A joiner never picks a game — the room code decides it.
  await player.page.getByRole('button', { name: 'Join a room instead' }).click();
  await player.page.getByLabel('Your name').fill(player.name);
  await player.page.getByLabel('Room code').fill(code);
  await player.page.getByRole('button', { name: 'Join game' }).click();
  await expect(player.page.locator('.lobby__code')).toHaveText(code);
}

export async function startMatch(players: Player[]): Promise<void> {
  for (const player of players) {
    await player.page.getByRole('button', { name: "I'm ready" }).click();
  }
  const host = players[0]!;
  const start = host.page.getByRole('button', { name: 'Start match' });
  await expect(start).toBeEnabled();
  await start.click();
  for (const player of players) {
    await expect(player.page.locator('.hand')).toBeVisible();
  }
}

/** Whichever player the table is waiting on. */
export async function activePlayer(players: Player[]): Promise<Player> {
  for (const player of players) {
    const turnbar = player.page.locator('.turnbar');
    if (((await turnbar.textContent()) ?? '').startsWith('Your turn')) return player;
  }
  throw new Error('no player is on turn');
}

/** The accessible label of every card in a player's hand, in display order. */
export async function handLabels(player: Player): Promise<string[]> {
  return player.page.locator('.hand__cards [data-card-id] .card').evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('aria-label') ?? ''),
  );
}

const SUIT_ORDER = ['spades', 'hearts', 'clubs', 'diamonds'];
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** True when a hand is in the app's own suit-then-rank order, jokers last. */
export function isSortedBySuit(labels: string[]): boolean {
  const keys = labels.map((label) => {
    if (label.startsWith('Joker')) return [99, 99] as const;
    const match = /^(\S+) of (\w+)/.exec(label);
    if (!match) return [98, 98] as const;
    return [SUIT_ORDER.indexOf(match[2]!), RANK_ORDER.indexOf(match[1]!)] as const;
  });
  for (let i = 1; i < keys.length; i++) {
    const [suitA, rankA] = keys[i - 1]!;
    const [suitB, rankB] = keys[i]!;
    if (suitA > suitB || (suitA === suitB && rankA > rankB)) return false;
  }
  return true;
}
