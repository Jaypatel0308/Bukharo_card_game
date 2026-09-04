import { expect, test, type Browser } from '@playwright/test';

import { createRoom, joinRoom, openPlayer, startMatch, type Player } from './table';

/**
 * One deck, three games.
 *
 * Every card on screen goes through the same component, so what this really
 * guards is that nobody reintroduces a second way of drawing one — and that
 * the face is legible at the sizes each game actually uses.
 */

test.describe('the cards', () => {
  let players: Player[];

  test.afterEach(async () => {
    for (const player of players ?? []) await player.page.context().close();
  });

  async function seat(browser: Browser, game: string, count: number) {
    players = [];
    for (const name of ['Rahul', 'Maya', 'Priya', 'Sam'].slice(0, count)) {
      players.push(await openPlayer(browser, name));
    }
    if (game === 'Bukharo') {
      const code = await createRoom(players[0]!);
      for (const p of players.slice(1)) await joinRoom(p, code);
      await startMatch(players);
      return;
    }
    await players[0]!.page.getByRole('button', { name: new RegExp(`^${game}`) }).click();
    await players[0]!.page.getByLabel('Your name').fill(players[0]!.name);
    await players[0]!.page.getByRole('button', { name: 'Create room' }).click();
    const code = ((await players[0]!.page.locator('.lobby__code').textContent()) ?? '').trim();
    for (const p of players.slice(1)) {
      await p.page.getByRole('button', { name: 'Join a room instead' }).click();
      await p.page.getByLabel('Your name').fill(p.name);
      await p.page.getByLabel('Room code').fill(code);
      await p.page.getByRole('button', { name: 'Join game' }).click();
      await expect(p.page.locator('.lobby__code')).toHaveText(code);
    }
    for (const p of players) await p.page.getByRole('button', { name: "I'm ready" }).click();
    const start = players[0]!.page.getByRole('button', { name: 'Start match' });
    await expect(start).toBeEnabled();
    await start.click();
    for (const p of players) await expect(p.page.locator('.hand')).toBeVisible();
  }

  for (const [game, count] of [['Bukharo', 4], ['Mindi', 4], ['Judgement', 3]] as const) {
    test(`look the same in ${game}`, async ({ browser }) => {
      await seat(browser, game, count);
      const card = players[0]!.page.locator('.hand__cards .card').first();
      await expect(card).toBeVisible();

      // The same printed stock everywhere, not a per-game variation.
      const face = await card.evaluate((el) => {
        const s = getComputedStyle(el);
        return { background: s.backgroundColor, font: s.fontFamily };
      });
      expect(face.background).toBe('rgb(246, 242, 228)');
      expect(face.font.toLowerCase()).toContain('serif');

      // Rank and suit are readable in both corners, as a real card is.
      await expect(card.locator('.card__index--tl')).toBeVisible();
      await expect(card.locator('.card__index--br')).toBeVisible();
    });
  }

  test('every card in a hand is drawn the same way', async ({ browser }) => {
    await seat(browser, 'Bukharo', 4);
    const cards = players[0]!.page.locator('.hand__cards .card');
    const count = await cards.count();
    expect(count).toBe(13);

    const faces = new Set<string>();
    for (let i = 0; i < count; i++) {
      faces.add(await cards.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor));
    }
    // Red and black cards share a face; only the ink differs.
    expect(faces.size).toBe(1);
  });
});
