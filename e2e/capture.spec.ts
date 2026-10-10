import { test, expect } from '@playwright/test';

test('records frames into IndexedDB', async ({ page }) => {
  // headless chromium has no screen: stand in a canvas stream for getDisplayMedia (pipeline downstream is real)
  await page.addInitScript(() => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d')!;
    let n = 0;
    setInterval(() => {
      g.fillStyle = n % 2 ? '#fff' : '#223';
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#c33'; g.font = '60px sans-serif';
      g.fillText('frame ' + n + ' hello world', 80 + (n % 7) * 40, 200 + (n % 5) * 90);
      for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${(n * 47 + i * 31) % 360} 70% 50%)`; g.fillRect((i * 97 + n * 53) % 1200, (i * 61) % 700, 70, 40); }
      n++;
    }, 100);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(10);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await expect(page.getByRole('status')).toContainText('REC');
  await page.waitForFunction(() => document.querySelectorAll('.frame').length >= 2, null, { timeout: 60_000 });
  const n = await page.evaluate(() => document.querySelectorAll('.frame').length);
  expect(n).toBeGreaterThanOrEqual(2);
});
