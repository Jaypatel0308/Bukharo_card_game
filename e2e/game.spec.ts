import { expect, test } from '@playwright/test';

import {
  activePlayer,
  createRoom,
  handLabels,
  isSortedBySuit,
  joinRoom,
  openPlayer,
  startMatch,
  type Player,
} from './table';

test.describe('four players, one browser each', () => {
  let players: Player[];

  test.beforeEach(async ({ browser }) => {
    players = [];
    for (const name of ['Rahul', 'Maya', 'Priya', 'Sam']) {
      players.push(await openPlayer(browser, name));
    }
    const code = await createRoom(players[0]!);
    for (const player of players.slice(1)) await joinRoom(player, code);
  });

  test.afterEach(async () => {
    for (const player of players) await player.page.context().close();
  });

  test('deal, draw, discard, and the turn moves on', async () => {
    await startMatch(players);

    // Everyone holds thirteen cards, and nobody can see anyone else's.
    for (const player of players) {
      await expect(player.page.locator('.hand__cards [data-card-id]')).toHaveCount(13);
      await expect(player.page.locator('.opponent').first()).toContainText('13 cards');
    }

    const active = await activePlayer(players);
    const waiting = players.filter((p) => p !== active);

    // Only the player on turn can act.
    await expect(active.page.getByRole('button', { name: 'Draw card' })).toBeEnabled();
    for (const player of waiting) {
      await expect(player.page.getByRole('button', { name: 'Draw card' })).toBeDisabled();
    }

    await active.page.getByRole('button', { name: 'Draw card' }).click();
    await expect(active.page.locator('.hand__cards [data-card-id]')).toHaveCount(14);
    await expect(active.page.locator('.hand__count')).toContainText('1 just picked up');

    // Discard the first card and watch the turn pass.
    await active.page.locator('.hand__cards [data-card-id] .card').first().click();
    await active.page.getByRole('button', { name: 'Discard', exact: true }).click();

    await expect(active.page.locator('.turnbar')).not.toContainText('Your turn');
    await expect(active.page.locator('.hand__cards [data-card-id]')).toHaveCount(13);

    // Somebody else is now on turn, and the whole table agrees.
    const next = await activePlayer(players);
    expect(next).not.toBe(active);
    for (const player of players) {
      await expect(player.page.locator('.pile__label').nth(2)).toContainText('Discard · 2');
    }
  });

  test('a drawn card lands in its place, not at the end', async () => {
    await startMatch(players);
    const active = await activePlayer(players);

    const before = await handLabels(active);
    expect(isSortedBySuit(before), `hand was not sorted to begin with: ${before.join(', ')}`).toBe(true);

    await active.page.getByRole('button', { name: 'Draw card' }).click();
    await expect(active.page.locator('.hand__cards [data-card-id]')).toHaveCount(14);

    const after = await handLabels(active);
    expect(isSortedBySuit(after), `hand lost its order after drawing: ${after.join(', ')}`).toBe(true);

    // And the new card is marked, wherever it landed.
    expect(after.filter((label) => label.includes('just picked up'))).toHaveLength(1);
  });

  test('the action buttons never change meaning under a waiting player', async () => {
    await startMatch(players);
    const active = await activePlayer(players);
    const waiting = players.find((p) => p !== active)!;

    // The bug this covers: the bar used to swap its contents between phases,
    // so the button in this position became "Draw card" the moment the turn
    // arrived, and a tap meant for the meld button drew a card.
    const labelsWhileWaiting = await waiting.page
      .locator('.actionbar button')
      .evaluateAll((buttons) => buttons.map((b) => b.textContent?.trim() ?? ''));

    await active.page.getByRole('button', { name: 'Draw card' }).click();
    await expect(active.page.locator('.hand__cards [data-card-id]')).toHaveCount(14);

    const labelsAfter = await waiting.page
      .locator('.actionbar button')
      .evaluateAll((buttons) => buttons.map((b) => b.textContent?.trim() ?? ''));
    expect(labelsAfter).toEqual(labelsWhileWaiting);

    // Clicking the meld button out of turn does nothing at all.
    const meld = waiting.page.getByRole('button', { name: /Open with|Create meld/ });
    await expect(meld).toBeDisabled();
    await meld.click({ force: true });
    await expect(waiting.page.locator('.hand__cards [data-card-id]')).toHaveCount(13);
  });

  test('a running commentary says what the table is doing', async () => {
    await startMatch(players);
    const active = await activePlayer(players);
    const watcher = players.find((p) => p !== active)!;

    // The watcher is told what the player on turn is up to, by name.
    await expect(watcher.page.locator('.activity__now')).toContainText(active.name);
    await expect(active.page.locator('.activity__now')).toContainText('You are');

    await active.page.getByRole('button', { name: 'Draw card' }).click();

    // And what just happened reaches everyone, without opening the log.
    for (const player of players) {
      await expect(player.page.locator('.activity__last')).toContainText('drew from the stock');
    }
  });

  test('no card is marked as wild, so a player can still throw one away', async () => {
    await startMatch(players);
    const active = await activePlayer(players);

    const marked = await active.page.evaluate(() => ({
      rings: document.querySelectorAll('.card.is-wild').length,
      badges: document.querySelectorAll('.card__wild').length,
      labelled: [...document.querySelectorAll('.hand__cards .card')].filter((c) =>
        (c.getAttribute('aria-label') ?? '').includes('wild'),
      ).length,
    }));

    expect(marked.rings).toBe(0);
    expect(marked.badges).toBe(0);
    expect(marked.labelled, 'a screen reader must not be told either').toBe(0);

    // The round's wild rank is still on the table for everyone to read.
    await expect(active.page.locator('.pile--wild .pile__label')).toContainText('Wild');
  });

  test('the whole discard pile can be read without hiding the hand', async () => {
    await startMatch(players);
    const active = await activePlayer(players);

    await active.page.getByRole('button', { name: 'See pile' }).click();
    const sheet = active.page.getByRole('dialog', { name: 'Discard pile' });
    await expect(sheet).toBeVisible();

    // The point of the sheet: your own cards stay visible behind it.
    await expect(active.page.locator('.hand__cards [data-card-id]').first()).toBeVisible();

    await sheet.getByRole('button', { name: 'Close discard pile' }).click();
    await expect(sheet).toBeHidden();
  });
});
