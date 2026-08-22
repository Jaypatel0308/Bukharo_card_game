import { expect, test } from '@playwright/test';

import { openPlayer } from './table';

/**
 * Choosing a game before making a room.
 *
 * The screen used to be branded Bukharo whatever you were setting up — the
 * heading, the tab, and the whole "how it works" list stayed Bukharo while you
 * configured a Mindi room. These check the page follows the choice.
 */

test.describe('choosing a game', () => {
  test('offers both games before anything else', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');

    await expect(host.page.getByRole('heading', { name: 'Card Table' })).toBeVisible();
    await expect(host.page.getByRole('button', { name: /^Bukharo/ })).toBeVisible();
    await expect(host.page.getByRole('button', { name: /^Mindi/ })).toBeVisible();

    // Nothing about a specific game's settings is on offer yet.
    await expect(host.page.getByLabel('Your name')).toHaveCount(0);

    await host.page.context().close();
  });

  test('takes its name, rules and tab title from the game picked', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    await host.page.getByRole('button', { name: /^Mindi/ }).click();

    await expect(host.page.getByRole('heading', { name: 'Mindi' })).toBeVisible();
    await expect(host.page.getByText('How Mindi works')).toBeVisible();
    await expect(host.page.getByText('How Bukharo works')).toHaveCount(0);
    await expect(host.page.getByText('Kot to lose')).toBeVisible();
    await expect(host.page).toHaveTitle(/Mindi/);

    // And back the other way, without a reload.
    await host.page.getByRole('button', { name: 'Change game' }).click();
    await host.page.getByRole('button', { name: /^Bukharo/ }).click();

    await expect(host.page.getByRole('heading', { name: 'Bukharo' })).toBeVisible();
    await expect(host.page.getByText('How Bukharo works')).toBeVisible();
    await expect(host.page.getByText('How Mindi works')).toHaveCount(0);
    await expect(host.page.getByText('Play to')).toBeVisible();
    await expect(host.page).toHaveTitle(/Bukharo/);

    await host.page.context().close();
  });

  test('keeps the name typed when the game is changed', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    await host.page.getByRole('button', { name: /^Bukharo/ }).click();
    await host.page.getByLabel('Your name').fill('Priya');
    await host.page.getByRole('button', { name: 'Change game' }).click();
    await host.page.getByRole('button', { name: /^Mindi/ }).click();

    await expect(host.page.getByLabel('Your name')).toHaveValue('Priya');
    await host.page.context().close();
  });

  test('never asks a joiner which game it is — the code decides', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    await host.page.getByRole('button', { name: 'Join a room instead' }).click();

    await expect(host.page.getByRole('heading', { name: 'Join a room' })).toBeVisible();
    await expect(host.page.getByLabel('Room code')).toBeVisible();
    await expect(host.page.getByRole('button', { name: /^Mindi/ })).toHaveCount(0);
    await expect(host.page.getByRole('button', { name: /^Bukharo/ })).toHaveCount(0);

    await host.page.context().close();
  });

  test('goes straight to joining when the link carries a room code', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/join/BKH7Q');

    // No game picker in the way of somebody who was invited.
    await expect(page.getByRole('heading', { name: 'Join a room' })).toBeVisible();
    await expect(page.getByLabel('Room code')).toHaveValue('BKH7Q');
    await expect(page.getByRole('button', { name: 'Change game' })).toHaveCount(0);

    await context.close();
  });
});
