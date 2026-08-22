import { expect, test } from '@playwright/test';

import { openPlayer, type Player } from './table';

/**
 * Mindi in a real browser, four players at once.
 *
 * The engine suite proves the rules; this proves a player can reach them —
 * choose how trump is set, see whose turn it is, and be stopped from playing
 * a card the rules forbid.
 */

async function createMindiRoom(player: Player): Promise<string> {
  await player.page.getByLabel('Your name').fill(player.name);
  await player.page.getByRole('button', { name: /^Mindi/ }).click();
  await player.page.getByRole('button', { name: 'Create room' }).click();
  const code = player.page.locator('.lobby__code');
  await expect(code).toBeVisible();
  return ((await code.textContent()) ?? '').trim();
}

async function joinMindiRoom(player: Player, code: string): Promise<void> {
  await player.page.getByRole('tab', { name: 'Join room' }).click();
  await player.page.getByLabel('Your name').fill(player.name);
  await player.page.getByLabel('Room code').fill(code);
  await player.page.getByRole('button', { name: 'Join game' }).click();
  await expect(player.page.locator('.lobby__code')).toHaveText(code);
}

test.describe('a game of Mindi', () => {
  let players: Player[];

  test.afterEach(async () => {
    for (const player of players ?? []) await player.page.context().close();
  });

  async function seatAndStart(browser: Parameters<typeof openPlayer>[0], count = 4) {
    players = [];
    for (const name of ['Rahul', 'Maya', 'Priya', 'Sam', 'Nina', 'Omar'].slice(0, count)) {
      players.push(await openPlayer(browser, name));
    }
    const code = await createMindiRoom(players[0]!);
    for (const player of players.slice(1)) await joinMindiRoom(player, code);

    for (const player of players) await player.page.getByRole('button', { name: "I'm ready" }).click();
    const start = players[0]!.page.getByRole('button', { name: 'Start match' });
    await expect(start).toBeEnabled();
    await start.click();
    for (const player of players) await expect(player.page.locator('.trick')).toBeVisible();
  }

  /** Whoever the table is waiting on to choose how trump is set. */
  async function chooser(): Promise<Player> {
    for (const player of players) {
      if (await player.page.getByRole('dialog', { name: 'How is trump set?' }).isVisible()) {
        return player;
      }
    }
    throw new Error('nobody was asked to choose');
  }

  /** Whoever is on turn, waiting for the table to agree before answering. */
  async function onTurn(): Promise<Player> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const onTurnNow: Player[] = [];
      for (const player of players) {
        const text = (await player.page.locator('.turnbar').textContent()) ?? '';
        if (text.startsWith('Your turn')) onTurnNow.push(player);
      }
      // Exactly one player at a time; more than that means a stale view.
      if (onTurnNow.length === 1) return onTurnNow[0]!;
      await players[0]!.page.waitForTimeout(100);
    }
    throw new Error('nobody is on turn');
  }

  test('deals thirteen each and asks one player how trump is set', async ({ browser }) => {
    await seatAndStart(browser);

    for (const player of players) {
      await expect(player.page.locator('.hand__cards [data-card-id]')).toHaveCount(13);
      await expect(player.page.locator('.mseat')).toHaveCount(4);
    }

    const decider = await chooser();
    // Everyone else is told to wait rather than left staring at nothing.
    for (const player of players) {
      if (player === decider) continue;
      await expect(player.page.locator('.turnbar')).toContainText('Waiting for');
    }
  });

  test('plays a card into the trick, and the table sees it', async ({ browser }) => {
    await seatAndStart(browser);
    const decider = await chooser();
    await decider.page.getByRole('button', { name: 'Play Katte' }).click();

    const leader = await onTurn();
    await leader.page.locator('.hand__cards [data-card-id] .card').first().click();
    await leader.page.getByRole('button', { name: 'Play card' }).click();

    await expect(leader.page.locator('.hand__cards [data-card-id]')).toHaveCount(12);
    for (const player of players) {
      await expect(player.page.locator('.trick__play')).toHaveCount(1);
    }
  });

  test('will not let a player break suit while they can follow it', async ({ browser }) => {
    await seatAndStart(browser);
    const decider = await chooser();
    await decider.page.getByRole('button', { name: 'Play Katte' }).click();

    const leader = await onTurn();
    const ledLabel = await leader.page
      .locator('.hand__cards [data-card-id] .card')
      .first()
      .getAttribute('aria-label');
    await leader.page.locator('.hand__cards [data-card-id] .card').first().click();
    await leader.page.getByRole('button', { name: 'Play card' }).click();
    await expect(leader.page.locator('.turnbar')).not.toContainText('Your turn');

    const suit = (ledLabel ?? '').split(' of ')[1];
    const next = await onTurn();
    const dimmed = await next.page.locator('.hand__slot.is-unplayable').count();
    const followable = await next.page.locator(`.hand__cards [aria-label*="of ${suit}"]`).count();

    // Either they hold the suit — in which case everything else is dimmed —
    // or they are void and everything stays available.
    if (followable > 0) {
      expect(dimmed).toBeGreaterThan(0);
      await expect(next.page.locator('.hint--floating')).toContainText(suit!);
    } else {
      expect(dimmed).toBe(0);
    }
  });

  test('tells the hider what they hid, and nobody else', async ({ browser }) => {
    await seatAndStart(browser);
    const decider = await chooser();
    await decider.page.getByRole('button', { name: 'Hide a card' }).click();

    const hint = decider.page.getByText(/^You hid /);
    await expect(hint).toBeVisible();

    // What they were told, so the same card can be hunted for elsewhere.
    const told = ((await hint.textContent()) ?? '').replace(/^You hid /, '').replace(/\..*$/, '');
    expect(told.length).toBeGreaterThan(0);

    for (const player of players) {
      if (player === decider) continue;
      await expect(player.page.getByText(/^You hid /)).toHaveCount(0);
      // The card itself must not be anywhere in their page either.
      const markup = await player.page.content();
      expect(markup).not.toContain(told);
    }
  });

  test('seats six when six are present', async ({ browser }) => {
    await seatAndStart(browser, 6);
    for (const player of players) {
      await expect(player.page.locator('.mseat')).toHaveCount(6);
      await expect(player.page.locator('.hand__cards [data-card-id]')).toHaveCount(17);
    }
  });
});
