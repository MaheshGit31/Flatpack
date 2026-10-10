import { expect, test } from '@playwright/test';

test('gemini is opt-in: nothing is sent until a key is saved and a button is pressed; only redacted frames go out', async ({ page }) => {
  const calls: { url: string; key: string | undefined; body: string }[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    calls.push({ url: req.url(), key: req.headers()['x-goog-api-key'], body: req.postData() ?? '' });
    const wantsJson = req.postData()?.includes('responseMimeType');
    const text = wantsJson ? JSON.stringify({ title: 'Pricing page', summary: 'The user compared plans.', details: ['Pro costs more'], tags: ['pricing'] }) : 'ready';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
  });

  await page.goto('/#/app/record');
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await expect(page.getByText(/Loaded \d+ frames/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('navigation').getByRole('link', { name: 'Ask AI' }).click();
  expect(calls).toHaveLength(0);

  // saving needs the disclosure box ticked
  await page.getByLabel('Gemini API key').fill('AIzaTESTKEY1234567890');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Tick the box');
  await page.getByLabel(/I understand the frames/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved in this browser/)).toBeVisible();
  expect(calls).toHaveLength(0);

  await page.getByRole('button', { name: 'Test key' }).click();
  await expect(page.getByText(/The key works/)).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.key).toBe('AIzaTESTKEY1234567890');
  expect(calls[0]!.url).not.toContain('AIza'); // key travels in a header, never the URL
  expect(calls[0]!.body).not.toContain('inline_data'); // the test sends no screen data

  // analyze a stored frame from the viewer
  await page.getByRole('navigation').getByRole('link', { name: 'Search' }).click();
  await page.getByLabel('Search what you saw').fill('pricing plans');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.result').first().click();
  await page.getByRole('button', { name: 'Analyze with Gemini' }).click();
  await expect(page.getByText('The user compared plans.')).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[1]!.body).toContain('inline_data');
  expect(calls[1]!.body).toContain('image/webp');
  expect(calls[1]!.body).not.toContain('AIza');
});

test('gemini errors are readable and the key can be removed', async ({ page }) => {
  await page.route('https://generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'quota' } }) }));
  await page.goto('/#/app/ask');
  await page.getByLabel('Gemini API key').fill('AIzaTESTKEY1234567890');
  await page.getByLabel(/I understand the frames/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Test key' }).click();
  await expect(page.getByRole('alert')).toContainText('rate limit');
  await page.getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByText('Key removed')).toBeVisible();
  await expect(page.getByText('not set up')).toBeVisible();
});
