import { expect, test } from '@playwright/test';

import { createRoom, joinRoom, openPlayer, type Player } from './table';

test.describe('the lobby', () => {
  let players: Player[];

  test.afterEach(async () => {
    for (const player of players ?? []) await player.page.context().close();
  });

  /**
   * The regression that prompted these tests. In a real browser the field is
   * driven by keystrokes rather than by a `change` event with a whole string,
   * which is exactly the difference jsdom could not show.
   */
  test('a team name can be typed, spaces and all, and cleared without springing back', async ({
    browser,
  }) => {
    const host = await openPlayer(browser, 'Rahul');
    players = [host];
    await createRoom(host);

    const field = host.page.getByLabel('Name for the red team');
    await expect(field).toHaveValue('Team A');

    // Clear it a character at a time: it must stay empty, not snap back.
    await field.click();
    await field.press('End');
    for (let i = 0; i < 'Team A'.length; i++) await field.press('Backspace');
    await expect(field).toHaveValue('');
    await host.page.waitForTimeout(900); // longer than the commit delay
    await expect(field).toHaveValue('');

    // Type a two word name, one key at a time, including the space.
    await field.pressSequentially('The Sharks', { delay: 30 });
    await expect(field).toHaveValue('The Sharks');

    // It survives the round trip to the server and back.
    await field.blur();
    await expect(field).toHaveValue('The Sharks');
    await host.page.waitForTimeout(600);
    await expect(field).toHaveValue('The Sharks');
  });

  test('a renamed team reaches the other players', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    const guest = await openPlayer(browser, 'Maya');
    players = [host, guest];

    const code = await createRoom(host);
    await joinRoom(guest, code);

    const field = host.page.getByLabel('Name for the blue team');
    await field.click();
    await field.press('End');
    for (let i = 0; i < 'Team B'.length; i++) await field.press('Backspace');
    await field.pressSequentially('Blue Comets', { delay: 20 });
    await field.blur();

    // The guest is not the host, so they see it as text rather than a field.
    await expect(
      guest.page.locator('.teamName__static').filter({ hasText: 'Blue Comets' }),
    ).toHaveCount(1);
  });

  test('an emptied name falls back rather than leaving a nameless team', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    players = [host];
    await createRoom(host);

    const field = host.page.getByLabel('Name for the red team');
    await field.click();
    await field.press('End');
    for (let i = 0; i < 'Team A'.length; i++) await field.press('Backspace');
    await expect(field).toHaveValue('');
    await field.blur();

    await expect(field).toHaveValue('Team A');
  });

  test('the theme survives a reload', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    players = [host];

    await host.page.getByRole('button', { name: 'Midnight' }).click();
    await expect(host.page.locator('html')).toHaveAttribute('data-theme', 'midnight');

    await host.page.reload();
    await expect(host.page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  });
});
