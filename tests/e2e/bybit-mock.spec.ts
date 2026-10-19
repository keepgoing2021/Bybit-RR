import { expect, test, type Page } from '@playwright/test';
import type { Scenario } from '../../src/core/scenario';

// 실제 Bybit 대신 공식 문서 형식을 따르는 가짜 서버(tests/e2e/mock-bybit.mjs)로
// Bybit 공급원 코드 경로(개발 서버 REST 프록시 + 브라우저 WebSocket + 재연결)를 확인한다.
const MOCK = 'http://localhost:5299';

async function openBybit(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('rrtool.v1.tourDone', '1'); // 첫 사용 안내는 따로 시험
  });
  await page.reload();
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await expect(page.getByTestId('btn-long')).toBeEnabled();
}

test('bybit provider loads symbols, candles and live trades through the app', async ({ page, request }) => {
  await openBybit(page);
  // 데모 데이터는 없다: 데이터 선택도, 데모 표시도 없다
  await expect(page.getByTestId('source')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('데모');
  await expect(page.getByTestId('feed-status')).toHaveText('실시간');
  await expect(page.getByTestId('symbol')).toHaveValue('BTCUSDT');
  await page.getByTestId('symbol').click();
  await expect(page.getByTestId('symbol-name')).toHaveText(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']); // USDC 무기한·상장 전 종목은 제외, 거래대금 순
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
  // TP(기본): 자동 SL에서 손익비 1:1.5 자리
  expect(s.auto.tp.rr).toBe(1.5);
  // 틱(0.1) 정수로 비교: 손절폭이 홀수 틱이면 1.5배가 반 틱이고, 엔트리에서 먼 쪽으로 반올림한다
  const t = (p: number) => Math.round(p * 10);
  expect(t(s.applied.tp!)).toBe(Math.round(t(s.entry) + 1.5 * (t(s.entry) - t(s.applied.sl!))));

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

  test('shows why Bybit REST failed; a reload recovers once Bybit answers again', async ({ page, request }) => {
    await request.post(`${MOCK}/mock/fail?route=instruments`);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('rrtool.v1.tourDone', '1'); // 첫 사용 안내는 따로 시험
    });
    await page.reload();
    await expect(page.getByTestId('load-error')).toBeVisible();
    await expect(page.getByTestId('load-error')).toContainText('종목 목록을 불러오지 못했습니다');
    await expect(page.getByTestId('load-error')).toContainText('403');
    await expect(page.getByTestId('load-error')).toContainText('새로고침');
    await expect(page.getByTestId('btn-long')).toBeDisabled();
    await request.post(`${MOCK}/mock/reset`);
    await page.reload();
    await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
    await expect(page.getByTestId('load-error')).toBeHidden();
  });
});

test('the real app is named 1RC: tab title, icon, home-screen icons and the top-left logo', async ({ page, request }) => {
  await openBybit(page);
  await expect(page).toHaveTitle('1RC — Crypto Risk Calculator');
  const head = await page.evaluate(() => ({
    icon: document.querySelector('link[rel=icon][type="image/svg+xml"]')?.getAttribute('href'),
    png: document.querySelector('link[rel=icon][type="image/png"]')?.getAttribute('href'),
    apple: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'),
    manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'),
    desc: document.querySelector('meta[name=description]')?.getAttribute('content') ?? '',
  }));
  expect(head).toMatchObject({ icon: '/favicon.svg', png: '/favicon-32.png', apple: '/apple-touch-icon.png', manifest: '/manifest.webmanifest' });
  expect(head.desc).toContain('리스크 계산기');
  // 파일이 실제로 서빙된다
  for (const [path, type] of [['/favicon.svg', 'svg'], ['/favicon-32.png', 'png'], ['/apple-touch-icon.png', 'png'], ['/icon-192.png', 'png'], ['/icon-512.png', 'png']]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(200);
    expect(r.headers()['content-type'], path).toContain(type);
  }
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m).toMatchObject({ short_name: '1RC', start_url: '/' });
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
  // 좌상단: 아이콘 + 1RC(1만 노랑) + 설명어
  const brand = page.getByTestId('brand');
  await expect(brand.locator('.brand-name')).toHaveText('1RC');
  await expect(brand.locator('.brand-sub')).toHaveText('crypto risk calc');
  expect(await brand.locator('.brand-one').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(232, 180, 76)');
  expect(await brand.locator('img.brand-mark').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText('RR 박스');
});

test('the real app shows the first-use tour on a first visit only', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('tour-count')).toHaveText('1 / 5');
  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tour')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('rrtool.v1.tourDone'))).toBe('1');
  await page.reload();
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await page.waitForTimeout(500);
  await expect(page.getByTestId('tour')).toBeHidden();
});

test('a save made on the removed demo data opens fresh on Bybit', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'rrtool.v1.state',
      JSON.stringify({ version: 1, scenario: { id: 'old-demo' }, ui: { provider: 'demo', symbol: 'DEMO-BTC', timeframe: '5' } }),
    ),
  );
  await page.reload();
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await expect(page.getByTestId('symbol')).toHaveValue('BTCUSDT');
  await expect(page.getByTestId('tf')).toHaveValue('15');
  expect(await page.evaluate(() => (window as unknown as { __rrDebug: { getScenario(): Scenario | null } }).__rrDebug.getScenario())).toBeNull();
  await expect(page.locator('.empty')).toBeVisible();
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

  test('the list opens sorted by 24h turnover like Bybit, with gainer / loser tabs, stats on every row, no "type more" cut-off', async ({ page }) => {
    await openBybit(page);
    await page.getByTestId('symbol').click();
    const names = page.getByTestId('symbol-name');
    const tab = (s: string) => page.getByTestId(`symbol-sort-${s}`);
    await expect(tab('volume')).toHaveClass(/active/);
    // 가짜 Bybit 24시간 요약: 거래대금 BTC 8.27B > ETH 6.57B > SOL 1.25B, 등락 SOL +13.91% > ETH +0.49% > BTC −0.81%
    await expect(names).toHaveText(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    await expect(page.getByTestId('symbol-turnover')).toHaveText(['8.27B', '6.57B', '1.25B']);
    await expect(page.getByTestId('symbol-change')).toHaveText(['−0.81%', '+0.49%', '+13.91%']);
    await expect(page.getByTestId('symbol-change').first()).toHaveClass(/down/);
    await expect(page.getByTestId('symbol-option').first().locator('.px')).toHaveText(/^\d{2},\d{3}\.\d$/); // 65,xxx.x (호가 단위 0.1)
    await expect(page.getByTestId('symbol-panel')).not.toContainText('더 입력');

    // 고른 탭 뒤의 알약: 열 때는 제자리, 탭을 바꾸면 미끄러져 옮겨 간다
    const pillOn = (s: string) => page.evaluate((id) => {
      const p = document.querySelector('[data-testid=symbol-pill]')!.getBoundingClientRect();
      const t = document.querySelector(`[data-testid=symbol-sort-${id}]`)!.getBoundingClientRect();
      return Math.abs(p.left - t.left) < 1 && Math.abs(p.width - t.width) < 1 && Math.abs(p.top - t.top) < 1;
    }, s);
    const sliding = () => page.getByTestId('symbol-pill').evaluate((el) => el.getAnimations().length > 0);
    expect(await pillOn('volume')).toBe(true);
    expect(await sliding()).toBe(false);
    await tab('gainers').click();
    expect(await sliding()).toBe(true);
    await expect.poll(() => pillOn('gainers')).toBe(true);
    await expect(names).toHaveText(['SOLUSDT', 'ETHUSDT', 'BTCUSDT']);
    await expect(page.getByTestId('symbol')).toBeFocused(); // 탭을 눌러도 목록이 닫히지 않는다
    await tab('losers').click();
    await expect(names).toHaveText(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    // 고른 정렬은 기억, 검색해도 그 순서 안에서 거른다
    await page.getByTestId('symbol').press('Escape');
    await page.reload();
    await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
    await page.getByTestId('symbol').click();
    await expect(tab('losers')).toHaveClass(/active/);
    expect(await pillOn('losers')).toBe(true); // 다시 열어도 고른 탭 자리에서 시작
    expect(await sliding()).toBe(false);
    await expect(names).toHaveText(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    // 'usdt'는 셋 다 맞음 → 검색 중에도 탭을 바꾸면 그 순서로
    await page.getByTestId('symbol').pressSequentially('usdt');
    await tab('gainers').click();
    await expect(names).toHaveText(['SOLUSDT', 'ETHUSDT', 'BTCUSDT']);
    // 고르면 그 종목으로
    await page.getByTestId('symbol-option').first().click();
    await expect(page.getByTestId('symbol')).toHaveValue('SOLUSDT');
    await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  });

  test('focusing the box lists every symbol, typing filters, clicking selects', async ({ page }) => {
    await openBybit(page);
    const box = page.getByTestId('symbol');
    await box.click();
    const names = page.getByTestId('symbol-name');
    await expect(names).toHaveText(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']); // 현재 값과 무관하게 전체 목록
    await box.pressSequentially('et');
    await expect(names).toHaveText(['ETHUSDT']);
    await page.getByTestId('symbol-option').first().click();
    await expect(box).toHaveValue('ETHUSDT');
    await expect(page.getByTestId('symbol-list')).toBeHidden();
  });
});
