import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious a11y violations on any tab (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/#/');
    await page.waitForTimeout(600);
    const land = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(land.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `landing: ${v.id} ${v.help}`)).toEqual([]);
    await page.goto('/#/app/record');
    await page.getByRole('button', { name: 'Load demo data' }).click();
    await expect(page.getByText(/Loaded \d+ frames/)).toBeVisible({ timeout: 60_000 });
    for (const tab of ['Overview', 'Record', 'Search', 'Timeline', 'Ask AI', 'Privacy', 'Benchmark']) {
      await page.getByRole('navigation').getByRole('link', { name: tab }).click();
      await page.waitForTimeout(400);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${tab}: ${v.id} (${v.nodes.length}) ${v.help}`), `${tab}`).toEqual([]);
    }
  });
}
