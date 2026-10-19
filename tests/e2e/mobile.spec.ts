import { expect, test, type Page } from '@playwright/test';
import type { Scenario } from '../../src/core/scenario';

// 폰 화면 (iPhone 13 크기·터치). 테스트 전용 화면(tests/harness)의 가짜 시세로 실행한다.
test.use({
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

type Debug = {
  getScenario(): Scenario | null;
  getHighlight(): { label: string; labelY: number } | null;
  legendBottom(): number;
};
type W = { __rrDebug: Debug };

async function open(page: Page) {
  await page.goto('/tests/harness/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
}
const rect = (page: Page, testid: string) => page.getByTestId(testid).evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);

test('phone: chart on the first screen, big LONG/SHORT fixed at the bottom, no sideways scroll', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const chart = await rect(page, 'chart');
  expect(chart.top).toBeLessThan(160); // 상단은 두 줄 (종목·차트·SL 기준 / 주문 설정 요약)
  expect(chart.height).toBeGreaterThanOrEqual(280);
  expect(chart.width).toBe(390); // 작도 도구 자리 없이 전체 폭
  await expect(page.getByTestId('draw-toolbar')).toBeHidden();

  for (const id of ['btn-long', 'btn-short']) {
    const r = await rect(page, id);
    expect(r.height).toBeGreaterThanOrEqual(44); // 엄지로 누르기 쉬운 크기
    expect(r.bottom).toBeGreaterThan(664 - 80); // 화면 맨 아래
    expect(r.width).toBeGreaterThan(150);
  }
  await page.getByTestId('btn-long').tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__rrDebug.getScenario())).not.toBeNull();

  // 끝까지 내려도 버튼은 그 자리, 패널 마지막 내용은 버튼에 가리지 않는다
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const long = await rect(page, 'btn-long');
  expect(long.bottom).toBeGreaterThan(664 - 80);
  const lastBottom = await page.locator('.panel > :last-child').evaluate((el) => el.getBoundingClientRect().bottom);
  const barTop = await page.locator('.topbar > .sides').evaluate((el) => el.getBoundingClientRect().top);
  expect(lastBottom).toBeLessThanOrEqual(barTop + 1);
});

test('phone: order settings fold into one summary line; tap to open, edits update the summary', async ({ page }) => {
  await open(page);
  const fold = page.getByTestId('sizing-toggle');
  await expect(fold).toBeVisible();
  await expect(fold).toHaveText('운영자산 입력 · 1% · 3분할 1:2:3');
  const notCut = () => fold.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(await notCut()).toBe(true);
  await expect(page.getByTestId('sizing-capital')).toBeHidden();

  await fold.tap();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('sizing-capital')).toBeVisible();
  await page.getByTestId('sizing-capital').fill('10000');
  await page.getByTestId('sizing-capital').press('Enter');
  await page.getByTestId('sizing-weights').fill('1:1:2');
  await page.getByTestId('sizing-weights').press('Enter');
  await expect(fold).toHaveText('10,000 USDT · 1% · 3분할 1:1:2');
  expect(await notCut()).toBe(true); // 한 줄 요약이 잘리지 않는다
  // 입력칸이 화면 밖으로 나가지 않는다
  for (const id of ['sizing-capital', 'sizing-risk', 'sizing-splits', 'sizing-weights']) expect((await rect(page, id)).right).toBeLessThanOrEqual(390);
  await fold.tap();
  await expect(page.getByTestId('sizing-capital')).toBeHidden();

  // iOS는 16px보다 작은 입력칸을 누르면 화면을 확대한다
  const sizes = await page.locator('.topbar input, .topbar select').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);

  // 알림은 아래 버튼에 가리지 않는다
  await fold.tap();
  await page.getByTestId('sizing-splits').fill('0');
  await page.getByTestId('sizing-splits').press('Enter');
  await expect(page.getByTestId('toast')).toBeVisible();
  const toast = await rect(page, 'toast');
  const barTop = await page.locator('.topbar > .sides').evaluate((el) => el.getBoundingClientRect().top);
  expect(toast.bottom).toBeLessThanOrEqual(barTop);
});

test('phone: theme switch is an icon button in the top bar and works by tap', async ({ page }) => {
  await open(page);
  const toggle = page.getByTestId('theme-toggle');
  const r = await rect(page, 'theme-toggle');
  expect(r.right).toBeLessThanOrEqual(390);
  expect(r.width).toBeGreaterThanOrEqual(32);
  await expect(toggle.locator('.label')).toBeHidden();
  await toggle.tap();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const barBg = await page.locator('.topbar > .sides').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(barBg).toBe('rgba(255, 255, 255, 0.94)');
});

test('phone: the symbol list fits the screen and shows stats on every row', async ({ page }) => {
  await open(page);
  await page.getByTestId('symbol').tap();
  const panel = await rect(page, 'symbol-panel');
  expect(panel.left).toBeGreaterThanOrEqual(0);
  expect(panel.right).toBeLessThanOrEqual(390);
  await expect(page.getByTestId('symbol-name')).toHaveText(['DEMO-BTC', 'DEMO-ETH', 'DEMO-SOL']); // 테스트 시세: 거래대금 BTC > ETH > SOL
  await expect(page.getByTestId('symbol-turnover')).toHaveText(['8.27B', '6.57B', '1.25B']);
  const changeRight = await page.getByTestId('symbol-change').first().evaluate((el) => el.getBoundingClientRect().right);
  expect(changeRight).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('phone: the SL candle label sits below the (wrapped) legend; SL 기준 shows "차트와 같음"', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('sltf').locator('option:checked')).toHaveText('차트와 같음');
  await page.getByTestId('btn-long').tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__rrDebug.getHighlight())).not.toBeNull();
  const [h, legendBottom] = await page.evaluate(() => {
    const d = (window as unknown as W).__rrDebug;
    return [d.getHighlight()!, d.legendBottom()] as const;
  });
  expect(h.labelY - 10).toBeGreaterThanOrEqual(legendBottom); // 칩 높이 20
});

test('phone: the first-use tour fits the screen at every step; the fold button stands in for the order settings; "?" is an icon', async ({ page }) => {
  await page.goto('/tests/harness/index.html?tour=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 20_000 });
  const targets = [
    '.topbar .field:has([data-testid=symbol])',
    '.topbar .sides',
    '[data-testid=sizing-toggle]',
    '.chart-wrap',
    '.panel .scenario',
  ];
  for (let k = 0; k < targets.length; k++) {
    await expect(page.getByTestId('tour-count')).toHaveText(`${k + 1} / 5`);
    await expect
      .poll(() =>
        page.evaluate((sel) => {
          const vw = document.documentElement.clientWidth;
          const vh = window.innerHeight;
          const t = document.querySelector(sel)!.getBoundingClientRect();
          const s = document.querySelector('[data-testid=tour-spot]')!.getBoundingClientRect();
          const p = document.querySelector('[data-testid=tour-tip]')!.getBoundingClientRect();
          const bar = document.querySelector('.topbar .sides')!.getBoundingClientRect();
          const self = document.querySelector(sel) === document.querySelector('.topbar .sides');
          return {
            // 대상이 통째로 보이고, 하단 LONG/SHORT 줄에 가리지 않는다
            targetOnScreen: t.top >= 0 && t.bottom <= (self ? vh : bar.top) + 0.5,
            covers: s.left <= Math.max(0, t.left) + 0.5 && s.right >= Math.min(vw, t.right) - 0.5 && s.top <= Math.max(0, t.top) + 0.5 && s.bottom >= Math.min(vh, t.bottom) - 0.5,
            tipInside: p.left >= 0 && p.top >= 0 && p.right <= vw && p.bottom <= vh,
          };
        }, targets[k]),
        { timeout: 3_000 },
      )
      .toEqual({ targetOnScreen: true, covers: true, tipInside: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const btn = await rect(page, 'tour-next');
    expect(btn.height).toBeGreaterThanOrEqual(40);
    await page.getByTestId('tour-next').tap();
  }
  await expect(page.getByTestId('tour')).toBeHidden();
  const q = await rect(page, 'tour-open');
  expect(q.width).toBeGreaterThanOrEqual(32);
  expect(q.right).toBeLessThanOrEqual((await rect(page, 'theme-toggle')).left);
  await expect(page.getByTestId('tour-open').locator('.label')).toBeHidden();
});

test('phone: panel RR chips sit in one row inside the screen, big enough to tap, and move TP', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-long').tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__rrDebug.getScenario())).not.toBeNull();
  const chips = page.getByTestId('rr-chip');
  await chips.first().scrollIntoViewIfNeeded();
  const boxes = await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(390);
    expect(b.height).toBeGreaterThanOrEqual(36);
    expect(b.width).toBeGreaterThanOrEqual(52);
  }
  await chips.nth(2).tap();
  await expect(page.getByTestId('rr-input')).toHaveValue('2');
  await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
  // 카드로 묶여도 주문표·패널이 옆으로 넘치지 않는다
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('phone: fee tier buttons fit one row, big enough to tap, and change the fee', async ({ page }) => {
  await open(page);
  await page.getByTestId('sizing-toggle').tap();
  await page.getByTestId('sizing-capital').fill('10000');
  await page.getByTestId('sizing-capital').press('Enter');
  await page.getByTestId('sizing-toggle').tap();
  await page.getByTestId('btn-long').tap();
  await expect(page.getByTestId('sizing-row').first()).toBeVisible();
  const tiers = page.getByTestId('fee-tier');
  await tiers.first().scrollIntoViewIfNeeded();
  const boxes = await tiers.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes).toHaveLength(6);
  expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(390);
    expect(b.height).toBeGreaterThanOrEqual(36);
  }
  const before = await page.getByTestId('sizing-fee').textContent();
  await tiers.nth(3).tap();
  await expect(page.getByTestId('fee-rates')).toHaveText('지정가 0.014% · 시장가 0.035%');
  await expect(page.getByTestId('sizing-fee')).not.toHaveText(before!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('phone: the stop-hunting zone label stays clear of the SL / target / RR labels', async ({ page }) => {
  await open(page);
  await page.getByTestId('tf').selectOption('D');
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await page.getByTestId('btn-long').tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__rrDebug.getScenario())).not.toBeNull();
  type Hunt = { x: number; x2: number; yNear: number; yFar: number; chip: { x: number; y: number; w: number; h: number } | null; avoided?: { x: number; y: number; w: number; h: number }[]; drawn?: string | null };
  const hunt = () => page.evaluate(() => (window as unknown as { __rrDebug: { getRenderedGeometry(): { hunt: Hunt | null } | null } }).__rrDebug.getRenderedGeometry()?.hunt ?? null);
  await expect.poll(async () => (await hunt())?.drawn ?? null).not.toBeNull();
  const h = (await hunt())!;
  // 화면 끝 칩은 다른 이름표와 겹칠 자리밖에 없으면 생략 (띠가 보이면 이름표는 꼭 있다)
  if (h.drawn === 'band') expect(h.chip).toBeTruthy();
  if (!h.chip) return;
  const c = h.chip;
  for (const a of h.avoided ?? []) expect(c.x < a.x + a.w && a.x < c.x + c.w && c.y < a.y + a.h && a.y < c.y + c.h).toBe(false);
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.x + c.w).toBeLessThanOrEqual(390);
  // 차트 칸 안 (아래로 잘리지 않게)
  const paneH = await page.evaluate(() => Math.max(...[...document.querySelectorAll('[data-testid=chart] canvas')].map((e) => e.getBoundingClientRect()).filter((b) => b.left < 50).map((b) => b.height)));
  expect(c.y).toBeGreaterThanOrEqual(0);
  expect(c.y + c.h).toBeLessThanOrEqual(paneH);
  // 화면 왼쪽으로 빠지지 않고 구간 안 (박스 폭 안, 띠가 보이면 띠 안)
  expect(c.x).toBeGreaterThanOrEqual(h.x);
  expect(c.x + c.w).toBeLessThanOrEqual(h.x2);
  if (h.drawn === 'band') {
    expect(c.y).toBeGreaterThanOrEqual(Math.max(0, Math.min(h.yNear, h.yFar)) - 0.5);
    expect(c.y + c.h).toBeLessThanOrEqual(Math.min(paneH, Math.max(h.yNear, h.yFar)) + 0.5);
  }
});

test('phone: SL 여유 row under the SL row fits the screen with tappable chips', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-long').tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__rrDebug.getScenario())).not.toBeNull();
  const row = page.getByTestId('sl-buffer-row');
  await row.scrollIntoViewIfNeeded();
  const r = await rect(page, 'sl-buffer-row');
  expect(r.right).toBeLessThanOrEqual(390);
  const chips = await page.getByTestId('sl-buffer-chip').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  expect(new Set(chips.map((b) => Math.round(b.top))).size).toBe(1);
  for (const b of chips) {
    expect(b.height).toBeGreaterThanOrEqual(36);
    expect(b.right).toBeLessThanOrEqual(390);
  }
  await page.getByTestId('sl-buffer-chip').nth(2).tap();
  await expect(page.getByTestId('sl-buffer')).toHaveValue('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('phone: no 5-minute board (top right is for wide screens only)', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('flow')).toBeHidden();
});
