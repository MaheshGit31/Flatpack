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
  await expect(page.locator('.rec-pill')).toContainText('REC');
  await expect(page).toHaveTitle(/● REC/);
  await page.waitForFunction(() => document.querySelectorAll('.frame').length >= 2, null, { timeout: 180_000 });
  const n = await page.evaluate(() => document.querySelectorAll('.frame').length);
  expect(n).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => (window as unknown as { __flatpak: any }).__flatpak.recorder().getSnapshot().stats.mode)).toBe('processor');
  // frames went through OCR + CLIP, not just storage
  const info = await page.evaluate(async () => {
    const f = (window as unknown as { __flatpak: any }).__flatpak;
    const frames = await f.store.listFrames();
    const ocr = await f.store.allOcr();
    return { text: ocr.map((o: { text: string }) => o.text).join(' '), acts: frames.map((x: { activity: string }) => x.activity), indexMs: frames.map((x: { indexMs: number }) => x.indexMs) };
  });
  expect(info.text.toLowerCase()).toContain('hello world');
  // pause stops the clock and the counters
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('.rec-pill')).toContainText('PAUSED');
  await expect(page).toHaveTitle(/paused/);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled();
  await expect(page).not.toHaveTitle(/REC/);
  const open = await page.evaluate(async () => (await (window as unknown as { __flatpak: any }).__flatpak.store.listSessions())[0].endedAt);
  expect(open).not.toBeNull();
});

test('fallback sampler (no MediaStreamTrackProcessor) still records frames', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor;
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d')!; let n = 0;
    setInterval(() => { g.fillStyle = n % 2 ? '#fff' : '#223'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#c33'; g.font = '60px sans-serif'; g.fillText('fallback ' + n + ' sampler', 80 + (n % 7) * 40, 200 + (n % 5) * 90); for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${(n * 47 + i * 31) % 360} 70% 50%)`; g.fillRect((i * 97 + n * 53) % 1200, (i * 61) % 700, 70, 40); } n++; }, 100);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(10);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.frame').length >= 2, null, { timeout: 180_000 });
  expect(await page.evaluate(() => (window as unknown as { __flatpak: any }).__flatpak.recorder().getSnapshot().stats.mode)).toBe('fallback');
  await page.getByRole('button', { name: 'Stop' }).click();
});
