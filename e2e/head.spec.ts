import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Real browser, real CLIP: correct a Timeline block, retrain on device, persist, and measure zero-shot vs trained head.
test('timeline correction retrains the head; benchmark reports measured zero-shot vs trained accuracy', async ({ page }) => {
  test.setTimeout(280_000);
  await page.goto('/#/app/offline');
  await page.getByRole('button', { name: 'Load demo screens' }).click();
  await page.waitForTimeout(1500);

  await page.goto('/#/app/timeline');
  await page.getByText('Label settings').click();
  const sel = page.getByRole('combobox', { name: /Activity of block/ }).first();
  await expect(sel).toBeVisible({ timeout: 30_000 });
  const opts = await sel.locator('option').allTextContents();
  const pick = opts.find((o) => /^(email|reading|shopping|maps)/.test(o)) ?? opts[1];
  await sel.selectOption({ label: pick });
  await expect(page.getByText(/trained on \d+/i)).toBeVisible({ timeout: 60_000 });

  // persisted in IndexedDB
  const saved = await page.evaluate(async () => !!(await (window as unknown as { __flatpak: any }).__flatpak.store.getHead()));
  expect(saved).toBe(true);

  await page.goto('/#/app/benchmark');
  await page.getByRole('radio', { name: /shipped test pack/i }).check();
  await page.getByRole('button', { name: 'Run holdout evaluation' }).click();
  await expect.poll(async () => page.evaluate(async () => !!(await (window as unknown as { __flatpak: any }).__flatpak.store.getKv('head-bench-last'))), { timeout: 240_000, intervals: [2000] }).toBe(true);
  const res = await page.evaluate(async () => (window as unknown as { __flatpak: any }).__flatpak.store.getKv('head-bench-last'));
  expect(res).toBeTruthy();
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/head-benchmark.json', JSON.stringify(res, null, 2));
});
