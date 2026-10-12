import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importSamples } from './helpers';
import { SCENES } from '../scripts/scenes.mjs';

const IDS = SCENES.map((s) => s.id);

test.describe('real pipeline over the sample screens', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/app/record');
    await page.waitForFunction(() => (window as unknown as { __flatpak?: unknown }).__flatpak);
  });

  test('known queries land in the top 5 (fused, via the real UI)', async ({ page }) => {
    const r = await importSamples(page, IDS);
    expect(r.stored).toBe(IDS.length - 1); // the recovery-phrase terminal is dropped by the block-list
    expect(r.skipped).toBe(1);
    await page.getByRole('navigation').getByRole('link', { name: 'Search' }).click();
    await page.locator('#q').fill('pricing plans');
    await page.locator('#q').press('Enter');
    await expect(page.locator('.result').first()).toBeVisible({ timeout: 120_000 });
    await page.locator('.result').first().click();
    await expect(page.getByRole('dialog', { name: 'Frame viewer' })).toBeVisible();
    await page.keyboard.press('Escape');
    // programmatic rank check against labelled scenes
    const ranks = await page.evaluate(async ({ sessionId, queries }) => {
      const f = (window as unknown as { __flatpak: any }).__flatpak;
      const frames = (await f.store.listFrames(sessionId)).sort((a: any, b: any) => a.seq - b.seq);
      const out: Record<string, number> = {};
      for (const [q, idx] of queries as [string, number][]) {
        const res = await f.searchClient().search(q, 'fused', {}, 10);
        const want = frames.find((fr: any) => fr.seq === idx)?.id;
        out[q] = res.hits.findIndex((h: any) => h.frameId === want) + 1;
      }
      return out;
    }, { sessionId: r.sessionId, queries: [['stack trace typeerror', IDS.indexOf('code')], ['route to golden gate park', IDS.indexOf('maps')], ['sourdough hydration', IDS.indexOf('doc')], ['flight to lisbon', IDS.indexOf('email')], ['red line chart', IDS.indexOf('dashboard')]] });
    for (const [q, rank] of Object.entries(ranks)) expect(rank, `rank of "${q}"`).toBeGreaterThan(0), expect(rank, `rank of "${q}"`).toBeLessThanOrEqual(5);
  });

  test('redaction is visible in the stored image and absent from stored text', async ({ page }) => {
    const r = await importSamples(page, ['checkout']);
    const res = await page.evaluate(async ({ sessionId, src }) => {
      const f = (window as unknown as { __flatpak: any }).__flatpak;
      const [fr] = await f.store.listFrames(sessionId);
      const blobs = await f.store.getBlobs(fr.id);
      const ocr = await f.store.getOcr(fr.id);
      const load = async (blob: Blob) => { const bm = await createImageBitmap(blob); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d')!; g.drawImage(bm, 0, 0); return g; };
      const orig = await load(await (await fetch('data:image/png;base64,' + src)).blob());
      const stored = await load(blobs.full);
      // card number sits at x 255..490, y 183..207 in the 1280x720 sample
      const diff = (x: number, y: number, w: number, h: number) => { const a = orig.getImageData(x, y, w, h).data, b = stored.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!); return s / (a.length / 4); };
      return { text: ocr.text as string, redactions: fr.redactions as number, card: diff(262, 184, 220, 22), title: diff(90, 40, 350, 50), email: diff(180, 303, 250, 28) };
    }, { sessionId: r.sessionId, src: readFileSync('samples/checkout.png').toString('base64') });
    expect(res.redactions).toBeGreaterThanOrEqual(3);
    expect(res.text).not.toMatch(/4242/);
    expect(res.text).not.toMatch(/jane\.doe/);
    expect(res.text).not.toMatch(/hunter2/);
    expect(res.text).toMatch(/Secure checkout/);
    expect(res.card, 'card pixels changed').toBeGreaterThan(8);
    expect(res.email, 'email pixels changed').toBeGreaterThan(8);
    expect(res.title, 'untouched text stays untouched').toBeLessThan(6);
  });

  test('block-listed screen stores nothing', async ({ page }) => {
    const r = await importSamples(page, ['terminal']);
    expect(r.stored).toBe(0);
    expect(await page.evaluate(async () => (await (window as unknown as { __flatpak: any }).__flatpak.store.frameCount()))).toBe(0);
  });

  test('demo data + benchmark page produce metrics and a JSON export', async ({ page }) => {
    await page.getByRole('button', { name: 'Load demo data' }).click();
    await expect(page.getByText(/Loaded \d+ frames/)).toBeVisible({ timeout: 60_000 });
    await page.goto('/#/app/benchmark');
    await page.getByRole('button', { name: 'Run benchmark' }).click();
    await expect(page.getByText(/queries ·/)).toBeVisible({ timeout: 300_000 });
    const rec = await page.evaluate(async () => (window as unknown as { __flatpak: any }).__flatpak.store.getKv('bench-last'));
    expect(rec.modes.fused.recall5).toBeGreaterThanOrEqual(0.9);
    expect(rec.modes.fused.mrr).toBeGreaterThan(rec.modes.clip.mrr);
    expect(rec.modes.fused.mrr).toBeGreaterThan(rec.modes.ocr.mrr);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    expect((await dl).suggestedFilename()).toMatch(/^flatpak-benchmark-.*\.json$/);
  });
});
