import { expect, test, type Page } from '@playwright/test';
import type { Scenario } from '../../src/core/scenario';

// 실제 Bybit 대신 공식 문서 형식을 따르는 가짜 서버(tests/e2e/mock-bybit.mjs)로
// Bybit 공급원 코드 경로(개발 서버 REST 프록시 + 브라우저 WebSocket + 재연결)를 확인한다.
const MOCK = 'http://localhost:5299';

async function openBybit(page: Page) {
  await page.goto('/?source=bybit');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await expect(page.getByTestId('btn-long')).toBeEnabled();
}

test('bybit provider loads symbols, candles and live trades through the app', async ({ page, request }) => {
  await openBybit(page);
  await expect(page.getByTestId('demo-badge')).toBeHidden();
  await expect(page.getByTestId('feed-status')).toHaveText('실시간');
  await expect(page.getByTestId('symbol')).toHaveValue('BTCUSDT');
  const options = await page.locator('#symbol-list option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(options).toEqual(['BTCUSDT', 'ETHUSDT']); // USDC 무기한·상장 전 종목은 제외
  expect(await page.evaluate(() => (window as unknown as { __rrDebug: { getCandleCount(): number } }).__rrDebug.getCandleCount())).toBe(1000);

  await page.getByTestId('btn-long').click();
  const s = (await page.waitForFunction(() =>
    (window as unknown as { __rrDebug: { getScenario(): Scenario | null } }).__rrDebug.getScenario(),
  ).then((h) => h.jsonValue())) as Scenario;
  expect(s.symbol).toBe('BTCUSDT');
  expect(s.priceSource).toBe('trade');
  expect(Number((Math.round(s.entry / 0.1) * 0.1).toFixed(1))).toBe(s.entry);
  expect(s.auto.sl.timeframe).toBe('15');
  expect(s.auto.tp.timeframe).toBe('60');

  const stats = await (await request.get(`${MOCK}/mock/stats`)).json();
  expect(stats.subscribes).toContainEqual(['kline.15.BTCUSDT', 'publicTrade.BTCUSDT', 'tickers.BTCUSDT']);
});

test('bybit provider reconnects and resubscribes after the server drops', async ({ page, request }) => {
  await openBybit(page);
  const before = await (await request.get(`${MOCK}/mock/stats`)).json();
  await request.post(`${MOCK}/mock/drop`);
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'disconnected');
  await expect(page.getByTestId('btn-long')).toBeDisabled();
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
  const after = await (await request.get(`${MOCK}/mock/stats`)).json();
  expect(after.connections).toBe(before.connections + 1);
  expect(after.subscribes.at(-1)).toEqual(['kline.15.BTCUSDT', 'publicTrade.BTCUSDT', 'tickers.BTCUSDT']);
});
