import { expect, test, type Browser } from '@playwright/test';

import { openPlayer, type Player } from './table';

/**
 * Judgement in a real browser.
 *
 * The engine suite proves the rules; this proves a player can reach them —
 * judge a number, be stopped from the one the rules forbid, and play a card.
 * It is also the first game with no teams, so the lobby has to look different.
 */

async function createJudgementRoom(player: Player, rounds?: string): Promise<string> {
  await player.page.getByRole('button', { name: /^Judgement/ }).click();
  await player.page.getByLabel('Your name').fill(player.name);
  if (rounds) await player.page.getByLabel('Or type a number').fill(rounds);
  await player.page.getByRole('button', { name: 'Create room' }).click();
  const code = player.page.locator('.lobby__code');
  await expect(code).toBeVisible();
  return ((await code.textContent()) ?? '').trim();
}

async function joinJudgementRoom(player: Player, code: string): Promise<void> {
  await player.page.getByRole('button', { name: 'Join a room instead' }).click();
  await player.page.getByLabel('Your name').fill(player.name);
  await player.page.getByLabel('Room code').fill(code);
  await player.page.getByRole('button', { name: 'Join game' }).click();
  await expect(player.page.locator('.lobby__code')).toHaveText(code);
}

test.describe('a game of Judgement', () => {
  let players: Player[];

  test.afterEach(async () => {
    for (const player of players ?? []) await player.page.context().close();
  });

  async function seatAndStart(browser: Browser, count = 3, rounds?: string) {
    players = [];
    for (const name of ['Rahul', 'Maya', 'Priya', 'Sam'].slice(0, count)) {
      players.push(await openPlayer(browser, name));
    }
    const code = await createJudgementRoom(players[0]!, rounds);
    for (const player of players.slice(1)) await joinJudgementRoom(player, code);
    for (const player of players) {
      await player.page.getByRole('button', { name: "I'm ready" }).click();
    }
    const start = players[0]!.page.getByRole('button', { name: 'Start match' });
    await expect(start).toBeEnabled();
    await start.click();
    for (const player of players) {
      await expect(player.page.locator('.turnbar')).toBeVisible();
    }
    return players;
  }

  test('seats three players, which no partnership game could', async ({ browser }) => {
    await seatAndStart(browser, 3);
    // Three at the table, and nobody in a team.
    for (const player of players) {
      await expect(player.page.locator('.jtable .jseat')).toHaveCount(2); // the other two
    }
  });

  test('shows no team panel in the lobby', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    players = [host];
    await createJudgementRoom(host);
    await expect(host.page.getByRole('heading', { name: 'Teams' })).toHaveCount(0);
    await expect(host.page.locator('.seat--team_a')).toHaveCount(0);
  });

  test('lets the host type any number of rounds', async ({ browser }) => {
    const host = await openPlayer(browser, 'Rahul');
    players = [host];
    await host.page.getByRole('button', { name: /^Judgement/ }).click();
    await host.page.getByLabel('Your name').fill('Rahul');
    const rounds = host.page.getByLabel('Or type a number');
    await expect(rounds).toBeVisible();
    await rounds.fill('7');
    await expect(rounds).toHaveValue('7');
  });

  test('deals one card in the first round, with spades as trump', async ({ browser }) => {
    await seatAndStart(browser, 3);
    const host = players[0]!;
    // §7 — round one is a single card. §22 — round one is always spades.
    await expect(host.page.locator('.hand__cards [data-card-id]')).toHaveCount(1);
    await expect(host.page.locator('.topbar__bucharooState')).toHaveText('♠');
  });

  test('asks the first player to judge, and nobody else', async ({ browser }) => {
    await seatAndStart(browser, 3);
    await onTurnToBid(players);
    const asked = [];
    for (const player of players) {
      const text = (await player.page.locator('.turnbar').textContent()) ?? '';
      if (text.startsWith('Look at your hand')) asked.push(player);
    }
    expect(asked).toHaveLength(1);
  });

  test('will not offer a judgement that makes the numbers add up', async ({ browser }) => {
    await seatAndStart(browser, 3);
    // One trick this round. Two players judge nothing, so the last cannot
    // judge one — it is shown, struck through, and disabled.
    for (let i = 0; i < 2; i++) {
      await judgeAs(players, async (bidder) => {
        await bidder.page.getByRole('button', { name: '0', exact: true }).click();
      });
    }
    const last = await onTurnToBid(players);
    const one = last.page.locator('.bidChoice', { hasText: /^1$/ });
    await expect(one).toBeDisabled();
    await expect(last.page.locator('.bidChoice', { hasText: /^0$/ })).toBeEnabled();
  });

  test('shows you your cards before asking you to judge', async ({ browser }) => {
    await seatAndStart(browser, 3);
    const bidder = await onTurnToBid(players);

    // The bar is on screen and so is the hand. It used to be a modal over the
    // top, so the first player judged before seeing a single card.
    await expect(bidder.page.locator('.bidbar')).toBeVisible();
    const cards = bidder.page.locator('.hand__cards [data-card-id]');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toBeVisible();

    // And the card is not hidden behind the bar.
    const card = await cards.first().boundingBox();
    const bar = await bidder.page.locator('.bidbar').boundingBox();
    expect(card).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(card!.y + card!.height).toBeLessThanOrEqual(bar!.y + 2);
  });

  test('seats everyone round the table, with the viewer at the bottom', async ({ browser }) => {
    await seatAndStart(browser, 4);
    const me = players[0]!;
    const seats = me.page.locator('.jtable .jseat');
    await expect(seats).toHaveCount(3);

    // Three opponents at three different places, none of them on top of
    // another — that is what "round the table" has to mean.
    const boxes = [];
    for (let i = 0; i < 3; i++) boxes.push(await seats.nth(i).boundingBox());
    const centres = boxes.map((b) => `${Math.round(b!.x / 20)},${Math.round(b!.y / 20)}`);
    expect(new Set(centres).size).toBe(3);
  });

  test('keeps a score board that says what was judged against what was taken', async ({ browser }) => {
    await seatAndStart(browser, 3);
    const me = players[0]!;

    await me.page.getByRole('button', { name: 'Score board' }).click();
    const board = me.page.getByRole('dialog', { name: 'Score board' });
    await expect(board).toBeVisible();

    // A column per player, and the running totals, from the very first round.
    for (const player of players) {
      await expect(board.getByRole('columnheader', { name: player.name })).toBeVisible();
    }
    await expect(board.getByText('Total')).toBeVisible();
    await expect(board.getByText('No rounds finished yet.')).toBeVisible();

    await board.getByRole('button', { name: 'Close' }).click();
    await expect(board).toBeHidden();
  });

  test('plays a card into the trick, and the table sees it', async ({ browser }) => {
    await seatAndStart(browser, 3);
    for (let i = 0; i < 3; i++) {
      await judgeAs(players, async (bidder) => {
        await bidder.page.locator('.bidChoice:not([disabled])').first().click();
      });
    }
    const leader = await onTurnToPlay(players);
    await leader.page.locator('.hand__cards [data-card-id]').first().click();
    await leader.page.getByRole('button', { name: 'Play card' }).click();

    for (const player of players) {
      await expect(player.page.locator('.jplay')).toHaveCount(1);
    }
  });
});

/**
 * Judges for whoever is being asked, and waits until that has registered.
 *
 * Both halves matter. Reading the dialog rather than the turn message returned
 * a player whose dialog was merely on its way out; and returning before their
 * own page had caught up returned the same player twice, so the assertion ran
 * against a table that was already moving on.
 */
async function judgeAs(players: Player[], pick: (page: Player) => Promise<void>): Promise<Player> {
  const bidder = await onTurnToBid(players);
  await pick(bidder);
  await expect(bidder.page.locator('.turnbar')).not.toContainText('Look at your hand');
  return bidder;
}

/** Whoever is being asked to judge. */
async function onTurnToBid(players: Player[]): Promise<Player> {
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const player of players) {
      const text = (await player.page.locator('.turnbar').textContent()) ?? '';
      if (text.startsWith('Look at your hand')) {
        await player.page.locator('.bidbar').waitFor();
        return player;
      }
    }
    await players[0]!.page.waitForTimeout(100);
  }
  throw new Error('nobody was asked to judge');
}

/** Whoever the table is waiting on to play a card. */
async function onTurnToPlay(players: Player[]): Promise<Player> {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const player of players) {
      const text = (await player.page.locator('.turnbar').textContent()) ?? '';
      if (text.startsWith('Your turn')) return player;
    }
    await players[0]!.page.waitForTimeout(100);
  }
  throw new Error('nobody is on turn');
}
