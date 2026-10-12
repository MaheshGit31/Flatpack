import { expect, test } from '@playwright/test';
import { importSamples } from './helpers';

// First run downloads the models (allowed). Second run, in the SAME browser context, must make zero requests to any other origin.
test('after the models are cached, indexing and searching make zero external requests', async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const warm = await ctx.newPage();
  await warm.goto('/#/app/record');
  await importSamples(warm, ['pricing']); // triggers the one-time model download
  await warm.close();

  const external: string[] = [];
  const all: string[] = [];
  ctx.on('request', (r) => { all.push(r.url()); if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  const page = await ctx.newPage();
  await page.goto('/#/app/record');
  const r = await importSamples(page, ['code', 'maps', 'checkout']);
  expect(r.stored).toBe(3);
  const hits = await page.evaluate(async () => (await (window as unknown as { __flatpak: any }).__flatpak.searchClient().search('golden gate park route', 'fused', {}, 5)).hits.length);
  expect(hits).toBeGreaterThan(0);
  expect(all.length).toBeGreaterThan(0); // we really were listening
  expect(external, `unexpected external requests:\n${external.join('\n')}`).toEqual([]);
  await ctx.close();
});

// The real thing: warm everything, cut the network at the browser level, cold-reload, and keep working.
test('airplane mode: after prepare, a cold reload and a search work with the network off', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto('/#/app/offline');
  await page.getByRole('button', { name: 'Load demo screens' }).click();
  await page.getByRole('button', { name: 'Prepare for offline' }).click();
  await expect(page.getByText('Ready: this app will open')).toBeVisible({ timeout: 200_000 }).catch(async () => { await page.reload(); await expect(page.getByText('Ready: this app will open')).toBeVisible({ timeout: 30_000 }); });

  await ctx.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Network: offline, still working/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Search offline' }).click();
  await expect(page.getByText(/network was off/)).toBeVisible({ timeout: 60_000 });
  await ctx.close();
});

test('simulated airplane mode refuses outside requests and flips the status chip', async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto('/#/app/offline');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then((r) => !!r?.active), null, { timeout: 20_000 }).catch(() => undefined);
  await page.reload();
  await page.getByRole('button', { name: 'Airplane mode (simulate)' }).click();
  await expect(page.getByText('Network: offline, still working').first()).toBeVisible();
  const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => false, () => true));
  expect(blocked).toBe(true);
  await ctx.close();
});
