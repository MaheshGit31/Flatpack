import { defineConfig } from '@playwright/test';

// Chromium needs the sandbox proxy only when it is set (CI/cloud); localhost is always direct.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
export default defineConfig({
  testDir: 'e2e',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      proxy,
      args: ['--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--use-fake-device-for-media-stream', '--ignore-certificate-errors'],
    },
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173', port: 4173, reuseExistingServer: true, timeout: 180_000 },
});
