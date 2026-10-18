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
  await page.getByTestId('symbol').click();
  await expect(page.getByTestId('symbol-option')).toHaveText(['BTCUSDT', 'ETHUSDT']); // USDC 무기한·상장 전 종목은 제외
  await page.getByTestId('symbol').press('Escape');
  await expect(page.getByTestId('symbol')).toHaveValue('BTCUSDT');
  expect(await page.evaluate(() => (window as unknown as { __rrDebug: { getCandleCount(): number } }).__rrDebug.getCandleCount())).toBe(1000);

  await page.getByTestId('btn-long').click();
  const s = (await page.waitForFunction(() =>
    (window as unknown as { __rrDebug: { getScenario(): Scenario | null } }).__rrDebug.getScenario(),
  ).then((h) => h.jsonValue())) as Scenario;
  expect(s.symbol).toBe('BTCUSDT');
  expect(s.priceSource).toBe('trade');
  expect(Number((Math.round(s.entry / 0.1) * 0.1).toFixed(1))).toBe(s.entry);
  // SL(기본): 15분봉 차트의 최근 확정 스윙 저점 — 오른쪽 2봉까지 엔트리 전에 마감된 것
  const M15 = 15 * 60_000;
  expect(s.auto.sl.method).toBe('swing');
  expect(s.auto.sl.timeframe).toBe('15');
  expect(s.auto.sl.candle!.time + 3 * M15).toBeLessThanOrEqual(s.priceTime);
  expect(s.auto.sl.candidatePrice).toBe(s.auto.sl.candle!.low);
  await expect(page.getByTestId('sl-rationale')).toContainText('15분봉 최근 확정 스윙 저점');
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

test.describe('failure handling', () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK}/mock/reset`);
  });

  test('shows why Bybit REST failed and still lets you switch to demo', async ({ page, request }) => {
    await request.post(`${MOCK}/mock/fail?route=instruments`);
    await page.goto('/?source=bybit');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('load-error')).toBeVisible();
    await expect(page.getByTestId('load-error')).toContainText('종목 목록을 불러오지 못했습니다');
    await expect(page.getByTestId('load-error')).toContainText('403');
    await expect(page.getByTestId('btn-long')).toBeDisabled();
    await page.getByTestId('source').selectOption('demo');
    await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
    await expect(page.getByTestId('load-error')).toBeHidden();
  });

  test('higher timeframe fetch failure still creates the scenario with a reason', async ({ page, request }) => {
    await openBybit(page);
    await request.post(`${MOCK}/mock/fail?route=kline&interval=60`);
    await page.getByTestId('btn-long').click();
    const s = (await page.waitForFunction(() =>
      (window as unknown as { __rrDebug: { getScenario(): Scenario | null } }).__rrDebug.getScenario(),
    ).then((h) => h.jsonValue())) as Scenario;
    expect(s.auto.tp.price).toBeNull();
    expect(s.auto.tp.reason).toContain('상위 시간봉 데이터 조회 실패');
    await expect(page.getByTestId('tp-rationale')).toContainText('상위 시간봉 데이터 조회 실패');
    await expect(page.getByTestId('btn-short')).toBeEnabled();
  });

  test('switching the data source clears a calculation made on the other source', async ({ page }) => {
    await page.goto('/?source=demo');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('btn-long').click();
    await page.waitForFunction(() =>
      (window as unknown as { __rrDebug: { getScenario(): Scenario | null } }).__rrDebug.getScenario(),
    );
    await page.getByTestId('source').selectOption('bybit');
    await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
    await expect(page.getByTestId('symbol')).toHaveValue('BTCUSDT');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __rrDebug: { getScenario(): Scenario | null } }).__rrDebug.getScenario()))
      .toBeNull();
    await expect(page.locator('.empty')).toBeVisible();
  });
});

test.describe('live candle', () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK}/mock/reset`);
  });

  test('last candle follows trades between slow kline pushes', async ({ page, request }) => {
    await request.post(`${MOCK}/mock/kline-every?ms=5000`);
    await openBybit(page);
    await page.waitForTimeout(1_000);
    type Snap = { lastCandle: { close: number; high: number; low: number } | null; lastPrice: { price: number } | null };
    const samples: Snap[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await page.evaluate(() =>
        (window as unknown as { __rrDebug: { getLiveSnapshot(): unknown } }).__rrDebug.getLiveSnapshot(),
      ) as Snap);
      await page.waitForTimeout(300);
    }
    for (const s of samples) {
      expect(s.lastCandle!.close).toBe(s.lastPrice!.price);
      expect(s.lastCandle!.high).toBeGreaterThanOrEqual(s.lastPrice!.price);
      expect(s.lastCandle!.low).toBeLessThanOrEqual(s.lastPrice!.price);
    }
  });
});

test.describe('symbol search', () => {
  test('typing part of a ticker and pressing Enter opens that symbol', async ({ page }) => {
    await openBybit(page);
    const box = page.getByTestId('symbol');
    await box.click();
    await box.pressSequentially('eth');
    await box.press('Enter');
    await expect(box).toHaveValue('ETHUSDT');
    await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  });

  test('focusing the box lists every symbol, typing filters, clicking selects', async ({ page }) => {
    await openBybit(page);
    const box = page.getByTestId('symbol');
    await box.click();
    const options = page.getByTestId('symbol-option');
    await expect(options).toHaveText(['BTCUSDT', 'ETHUSDT']); // 현재 값과 무관하게 전체 목록
    await box.pressSequentially('et');
    await expect(options).toHaveText(['ETHUSDT']);
    await options.first().click();
    await expect(box).toHaveValue('ETHUSDT');
    await expect(page.getByTestId('symbol-list')).toBeHidden();
  });
});
