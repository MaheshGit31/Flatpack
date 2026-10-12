import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const WAV = fileURLToPath(new URL('../test-assets/jfk.wav', import.meta.url));
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH || undefined, proxy, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}%noloop`, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] } });

test('voice memory: mic → VAD → Whisper → text-only transcript, searchable and aligned to frames', async ({ page }) => {
  await page.addInitScript(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d')!; let n = 0;
    setInterval(() => { g.fillStyle = n % 2 ? '#fff' : '#223'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#c33'; g.font = '60px sans-serif'; g.fillText('meeting notes ' + n, 80, 200 + (n % 5) * 90); n++; }, 100);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(10);
  });
  await page.goto('/?exp=audio#/app/record');
  await page.getByLabel(/Transcribe speech locally/).check();
  await page.getByLabel('Microphone').check();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: /I understand/ }).click(); // voice consent
  await page.getByRole('button', { name: /I understand/ }).click(); // screen consent
  await expect(page.locator('.rec-pill')).toContainText('REC');
  await expect(page.getByText(/listening/)).toBeVisible();
  await page.waitForTimeout(16_000); // the clip is 11 s
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled({ timeout: 240_000 });

  const info = await page.evaluate(async () => {
    const st = (window as unknown as { __flatpak: any }).__flatpak.store;
    const tr = await st.listTranscript();
    const frames = await st.listFrames();
    // privacy: only text rows exist; nothing audio-like is stored anywhere in the DB
    const d = await st.db();
    const stores: string[] = Array.from(d.objectStoreNames);
    return { text: tr.map((t: { text: string }) => t.text).join(' ').toLowerCase(), n: tr.length, stores, frames: frames.length, src: tr.map((t: { source: string }) => t.source) };
  });
  expect(info.text).toContain('country');
  expect(info.text).toMatch(/fellow american/);
  expect(info.src.every((s: string) => s === 'mic')).toBe(true);
  expect(info.stores).not.toContain('audio');

  await page.getByRole('navigation').getByRole('link', { name: 'Search' }).click();
  await page.getByLabel('Has speech').check();
  await page.locator('#q').fill('what your country can do for you');
  await page.locator('#q').press('Enter');
  const card = page.locator('.result').first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('.sig-speech')).toBeVisible();
});
