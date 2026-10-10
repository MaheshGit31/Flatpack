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
