import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--use-fake-device-for-media-stream', '--enable-features=WebCodecs'],
    },
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173', port: 4173, reuseExistingServer: true, timeout: 180_000 },
});
