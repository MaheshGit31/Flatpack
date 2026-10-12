import { expect, test } from '@playwright/test';

test('home: examples, search from home, start + pause', async ({ page }) => {
  test.setTimeout(200_000);
  await page.goto('/#/app/overview');
  await expect(page.getByRole('button', { name: 'Start remembering' })).toBeVisible();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await expect(page.getByText(/Added \d+ example moments/)).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Search your memory').fill('pricing table');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.result').first()).toBeVisible({ timeout: 90_000 });
  await page.goto('/#/app/overview');
  await page.getByRole('button', { name: 'Start remembering' }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await expect(page.getByText(/Remembering…/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText(/Paused/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
});
