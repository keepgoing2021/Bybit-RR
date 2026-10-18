import { defineConfig } from '@playwright/test';

/**
 * E2E는 데모 데이터로 실행한다 (실제 Bybit 연결은 scripts/check-bybit.mjs로 따로 확인).
 * 브라우저: 기본은 `npx playwright install chromium`으로 설치한 Chromium.
 * PW_CHROMIUM_PATH 환경변수가 있으면 그 실행 파일을 쓴다.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath
      ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }
      : {},
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
