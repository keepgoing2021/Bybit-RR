import { defineConfig } from '@playwright/test';

/**
 * E2E: app.spec.ts는 테스트 전용 화면(tests/harness, 배속 가짜 시세), bybit-mock.spec.ts는 가짜 Bybit 서버로 실행한다.
 * 배포되는 앱에는 가짜 시세가 없다. 실제 Bybit 연결은 scripts/check-bybit.mjs로 따로 확인.
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
  webServer: [
    // 공식 문서 형식을 따르는 가짜 Bybit (tests/e2e/mock-bybit.mjs). 실제 Bybit가 아니다.
    {
      command: 'node tests/e2e/mock-bybit.mjs',
      url: 'http://localhost:5299/mock/stats',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npx vite --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        BYBIT_REST_TARGET: 'http://localhost:5299',
        VITE_BYBIT_WS: 'ws://localhost:5299/v5/public/linear',
      },
    },
  ],
});
