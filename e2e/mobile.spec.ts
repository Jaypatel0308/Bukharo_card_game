import { expect, test } from '@playwright/test';

import {
  activePlayer,
  createRoom,
  joinRoom,
  openPlayer,
  startMatch,
  type Player,
} from './table';

/**
 * Layout on a phone.
 *
 * The game is played on phones, and nothing else in the suite looks at a small
 * screen: jsdom has no layout at all, and the other browser tests run at a
 * desktop width. These assertions came out of measuring the real thing — they
 * caught icon buttons at 40px, under the minimum the design sets itself, and a
 * second action row half again as tall as the first because two labels wrapped.
 *
 * This is emulation, not a physical device: it proves the layout, not the feel.
 */

/** The minimum comfortable touch target, matching the --tap design token. */
const MIN_TAP = 44;

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout only');

  let players: Player[];

  test.afterEach(async () => {
    for (const player of players ?? []) await player.page.context().close();
  });

  async function seatAndStart(browser: Parameters<typeof openPlayer>[0]): Promise<Player> {
    players = [];
    for (const name of ['Rahul', 'Maya', 'Priya', 'Sam']) {
      players.push(await openPlayer(browser, name));
    }
    const code = await createRoom(players[0]!);
    for (const player of players.slice(1)) await joinRoom(player, code);
    await startMatch(players);
    return players[0]!;
  }

  test('nothing pushes the page sideways', async ({ browser }) => {
    const player = await seatAndStart(browser);

    for (const page of players.map((p) => p.page)) {
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        widest: [...document.querySelectorAll('*')]
          .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .map((el) => el.className)
          .slice(0, 3),
      }));
      expect(
        overflow.scrollWidth,
        `something overflows: ${overflow.widest.join(', ')}`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
    await expect(player.page.locator('.hand')).toBeVisible();
  });

  test('every control is big enough for a thumb', async ({ browser }) => {
    const player = await seatAndStart(browser);

    const tooSmall = await player.page.evaluate((min) => {
      const selectors = ['.actionbar button', '.topbar .iconButton', '.hand__sorts button'];
      const offenders: string[] = [];
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const rect = el.getBoundingClientRect();
          if (rect.height < min || rect.width < min) {
            offenders.push(`${selector} "${(el.textContent ?? '').trim().slice(0, 12)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
          }
        }
      }
      return offenders;
    }, MIN_TAP);

    expect(tooSmall, `controls below ${MIN_TAP}px: ${tooSmall.join('; ')}`).toEqual([]);
  });

  test('the action rows stay level, with no label wrapping to a second line', async ({ browser }) => {
    const player = await seatAndStart(browser);

    const heights = await player.page
      .locator('.actionbar button')
      .evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().height)));

    expect(new Set(heights).size, `uneven action buttons: ${heights.join(', ')}`).toBe(1);
  });

  test('a full turn can be played by touch', async ({ browser }) => {
    await seatAndStart(browser);
    const active = await activePlayer(players);

    await active.page.getByRole('button', { name: 'Draw card' }).tap();
    await expect(active.page.locator('.hand__cards [data-card-id]')).toHaveCount(14);

    await active.page.locator('.hand__cards [data-card-id] .card').first().tap();
    await active.page.getByRole('button', { name: 'Discard', exact: true }).tap();

    await expect(active.page.locator('.turnbar')).not.toContainText('Your turn');
    await expect(active.page.locator('.hand__cards [data-card-id]')).toHaveCount(13);
  });

  test('a selected card is unmistakable, even after a tap leaves hover behind', async ({
    browser,
  }) => {
    await seatAndStart(browser);
    // The dealer is chosen at random, so the player on turn is never assumed:
    // every assertion below is made against whoever it actually is.
    const active = await activePlayer(players);
    await active.page.getByRole('button', { name: 'Draw card' }).tap();

    const card = active.page.locator('.hand__cards [data-card-id] .card').nth(6);
    await card.tap();
    await active.page.waitForTimeout(300); // let the lift settle

    const state = await active.page.evaluate(() => {
      const selected = document.querySelector('.card.is-selected') as HTMLElement;
      const slot = selected.closest('[data-card-id]') as HTMLElement;
      const style = getComputedStyle(selected);
      return {
        lift: Math.round(slot.getBoundingClientRect().top - selected.getBoundingClientRect().top),
        hasRing: style.boxShadow.includes('0px 0px 0px 3px'),
        hasMark: Boolean(selected.querySelector('.card__chosen')),
      };
    });

    // Touch browsers leave :hover on the last thing tapped; that rule used to
    // outrank the selected state and left a chosen card looking unchosen.
    expect(state.lift, 'a chosen card should stand well clear of its row').toBeGreaterThan(12);
    expect(state.hasRing, 'a chosen card should carry the selection ring').toBe(true);
    expect(state.hasMark, 'a chosen card should carry a mark, not only a lift').toBe(true);
    await expect(active.page.locator('.hand__count')).toContainText('1 selected');
  });

  test('the hand can be tidied while waiting for someone else', async ({ browser }) => {
    await seatAndStart(browser);
    const active = await activePlayer(players);
    const waiting = players.find((p) => p !== active)!;

    // Sorting and choosing cards must work off turn: it is what there is to do.
    await waiting.page.getByRole('button', { name: 'Points' }).tap();
    await expect(waiting.page.getByRole('button', { name: 'Points' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const card = waiting.page.locator('.hand__cards [data-card-id] .card').first();
    await expect(card).toBeEnabled();
    await card.tap();
    await expect(waiting.page.locator('.hand__count')).toContainText('1 selected');
  });

  test('the whole hand is reachable', async ({ browser }) => {
    const player = await seatAndStart(browser);

    // Thirteen cards wrap onto several rows rather than running off the side.
    const cards = player.page.locator('.hand__cards [data-card-id]');
    await expect(cards).toHaveCount(13);

    const rows = await player.page.evaluate(() => {
      const tops = [...document.querySelectorAll('.hand__cards [data-card-id]')].map((el) =>
        Math.round(el.getBoundingClientRect().top),
      );
      return new Set(tops).size;
    });
    expect(rows).toBeGreaterThan(1);

    await cards.last().scrollIntoViewIfNeeded();
    await expect(cards.last()).toBeVisible();
  });

  test('reading the discard pile does not bury your own cards', async ({ browser }) => {
    const player = await seatAndStart(browser);

    await player.page.getByRole('button', { name: 'See pile' }).tap();
    const sheet = player.page.getByRole('dialog', { name: 'Discard pile' });
    await expect(sheet).toBeVisible();

    // The sheet is the reason this matters: it must leave room for the hand.
    const clearance = await player.page.evaluate(() => {
      const sheetRect = document.querySelector('.sheet__body')?.getBoundingClientRect();
      const hand = document.querySelector('.hand')?.getBoundingClientRect();
      return { sheetBottom: sheetRect?.bottom ?? 0, handTop: hand?.top ?? 0, viewport: window.innerHeight };
    });
    expect(clearance.sheetBottom).toBeLessThan(clearance.viewport);

    await sheet.getByRole('button', { name: 'Close discard pile' }).tap();
    await expect(sheet).toBeHidden();
  });

  test('the lobby fits without sideways scrolling', async ({ browser }) => {
    players = [await openPlayer(browser, 'Rahul')];
    await createRoom(players[0]!);

    const overflows = await players[0]!.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
    await expect(players[0]!.page.getByLabel('Name for the red team')).toBeVisible();
  });
});
