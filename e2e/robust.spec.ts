import { expect, test } from '@playwright/test';

const fakeScreen = () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const g = c.getContext('2d')!; let n = 0;
  setInterval(() => { g.fillStyle = n % 2 ? '#fff' : '#223'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#c33'; g.font = '60px sans-serif'; g.fillText('robust ' + n, 80 + (n % 7) * 40, 200 + (n % 5) * 90); for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${(n * 47 + i * 31) % 360} 70% 50%)`; g.fillRect((i * 97 + n * 53) % 1200, (i * 61) % 700, 70, 40); } n++; }, 100);
  navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(10);
};

test('unsupported browser: clear message, demo still reachable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined }); });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText("can't run Flatpak");
  await expect(page.getByRole('alert')).toContainText('Chrome or Edge');
  await expect(page.getByRole('button', { name: 'Load demo data' })).toBeVisible();
});

test('permission denied: nothing recorded, clear error, can retry', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await expect(page.getByRole('alert')).toContainText('cancelled or denied');
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled();
  expect(await page.evaluate(async () => (await (window as unknown as { __flatpak: any }).__flatpak.store.listSessions()).length)).toBe(0);
});

test('user stops sharing from the browser UI: session closes cleanly', async ({ page }) => {
  await page.addInitScript(fakeScreen);
  await page.addInitScript(() => {
    const orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (c) => { const s = await orig(c); (window as unknown as { __stream: MediaStream }).__stream = s; return s; };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await expect(page.locator('.rec-pill')).toContainText('REC');
  await page.evaluate(() => { const t = (window as unknown as { __stream: MediaStream }).__stream.getVideoTracks()[0]!; t.stop(); t.dispatchEvent(new Event('ended')); });
  await expect(page.locator('.rec-pill')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled();
  const ended = await page.evaluate(async () => (await (window as unknown as { __flatpak: any }).__flatpak.store.listSessions())[0].endedAt);
  expect(ended).not.toBeNull();
});

test('index worker crash: capture keeps going, worker is restarted, indexing resumes', async ({ page }) => {
  await page.addInitScript(fakeScreen);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.frame').length >= 2, null, { timeout: 180_000 });
  const before = await page.evaluate(async () => (await (window as unknown as { __flatpak: any }).__flatpak.store.frameCount()));
  // simulate a crash of the index worker
  await page.evaluate(() => { const c = (window as unknown as { __flatpak: any }).__flatpak.indexClient(); c.worker.dispatchEvent(new Event('error')); });
  await expect(page.locator('.rec-pill')).toContainText('REC'); // still recording
  await page.waitForFunction(async (b) => (await (window as unknown as { __flatpak: any }).__flatpak.store.frameCount()) > b + 1, before, { timeout: 180_000 });
  await page.getByRole('button', { name: 'Stop' }).click();
});

test('reload mid-recording: data survives and the dangling session is closed', async ({ page }) => {
  await page.addInitScript(fakeScreen);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.frame').length >= 2, null, { timeout: 180_000 });
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __flatpak?: unknown }).__flatpak);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => { const s = (window as unknown as { __flatpak: any }).__flatpak.store; return { n: await s.frameCount(), sessions: await s.listSessions() }; });
  expect(r.n).toBeGreaterThanOrEqual(2);
  expect(r.sessions[0].endedAt).not.toBeNull();
  await page.getByRole('navigation').getByRole('button', { name: 'Timeline' }).click();
  await expect(page.locator('.block').first()).toBeVisible();
});
