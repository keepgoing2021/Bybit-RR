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
