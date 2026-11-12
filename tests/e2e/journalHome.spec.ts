import { expect, test, type Page } from '@playwright/test';

// 저널 개편 (2026-11-11): 청산 카드(칩) · 달력 · 주간 리뷰 · 통계
const DAY = 86_400_000;
const trade = (id: string, exit: number | null, closedAt: number | null = Date.now() - 3600_000, extra: Record<string, unknown> = {}) => ({
  id, symbol: 'BTCUSDT', side: 'LONG', entry: 100, sl: 98, tp: 104, qty: null, riskUsdt: 10, riskPct: 1,
  openedAt: (closedAt ?? Date.now()) - 3600_000, closedAt: exit === null ? null : closedAt, exit,
  setup: '스윕 반전', quality: 'rule', reason: '', rules: [], feeRate: 0.00055, ...extra,
});
const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

async function seed(page: Page, trades: unknown[], extra: Record<string, unknown> = {}) {
  await page.goto('/journal.html');
  await page.evaluate(([t, e]) => {
    localStorage.clear();
    localStorage.setItem('rrtool.v1.journal', JSON.stringify({ version: 1, trades: t, settings: {}, ...(e as object) }));
  }, [trades, extra] as const);
  await page.reload();
}
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.journal')!));

// 가상 거래 자동 추적이 진짜 Bybit 시세로 시험용 거래를 청산하지 않게 막는다
test.beforeEach(async ({ page }) => {
  await page.route('**/v5/market/**', (r) => r.abort());
});

test('청산 카드: 청산가 + 칩 두 번 + 저장 → 기록되고 연속 기록 1일', async ({ page }) => {
  await seed(page, [trade('b', null)]);
  const save = page.getByTestId('j-close-b');
  await expect(save).toBeDisabled();
  await page.getByTestId('j-exit-b').fill('abc');
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('j-open')).toContainText('청산가를 숫자로 넣어 주세요');
  await page.getByTestId('j-exit-b').fill('104');
  await expect(page.getByTestId('j-preview-b')).toContainText('+2.00R');
  await page.getByTestId('j-rule-b-kept').click();
  await page.getByTestId('j-mood-b-calm').click();
  await expect(page.getByTestId('j-rule-b-kept')).toHaveAttribute('aria-pressed', 'true');
  await save.click();
  const t = (await stored(page)).trades[0];
  expect(t.exit).toBe(104);
  expect(t.closeRule).toBe('kept');
  expect(t.mood).toBe('calm');
  await expect(page.getByTestId('j-streak')).toContainText('1일');
  await expect(page.getByTestId('j-closed')).toContainText('끝난 거래 1');
});

test('청산 카드: 칩 없이도 저장되고, 거래 목록에서 나중에 채운다', async ({ page }) => {
  await seed(page, [trade('b', null)]);
  await page.getByTestId('j-open').getByRole('button', { name: '목표가로' }).click();
  await expect(page.getByTestId('j-exit-b')).toHaveValue('104');
  await expect(page.getByTestId('j-open')).toContainText('진행 중 1'); // 누르자마자 청산되지 않는다
  await page.getByTestId('j-close-b').click();
  expect('closeRule' in (await stored(page)).trades[0]).toBe(false);
  await expect(page.getByTestId('j-streak')).toContainText('0일');
  await page.getByTestId('j-fill-b').click();
  await page.getByTestId('j-rule-b-movedSl').click();
  await page.getByTestId('j-mood-b-tired').click();
  const t = (await stored(page)).trades[0];
  expect(t.closeRule).toBe('movedSl');
  expect(t.mood).toBe('tired');
});

test('달력: 펼치면 날짜 칸에 R, 형태를 기억하고, 날짜를 누르면 그날 거래만', async ({ page }) => {
  const now = Date.now();
  const a = now - 3600_000;
  // 같은 달 안의 다른 날 (월초면 내일 쪽이 아니라 그제 대신 어제)
  const b = new Date(a + 9 * 3600_000).getUTCDate() > 1 ? a - DAY : a - 60_000;
  await seed(page, [trade('a', 104, a), trade('c', 98, b)]);
  await expect(page.getByTestId('j-strip')).toBeVisible();
  await page.getByTestId('j-cal-toggle').click();
  await expect(page.getByTestId('j-cal')).toBeVisible();
  const sameDay = kstDay(a) === kstDay(b);
  await expect(page.getByTestId(`j-day-${kstDay(a)}`)).toContainText(sameDay ? '+1.0R' : '+2.0R');
  await page.reload();
  await expect(page.getByTestId('j-cal')).toBeVisible();
  await page.getByTestId(`j-day-${kstDay(a)}`).click();
  await expect(page.getByTestId('j-closed')).toContainText(sameDay ? '끝난 거래 2' : '끝난 거래 1');
  await page.getByTestId('j-day-clear').click();
  await expect(page.getByTestId('j-closed')).toContainText('끝난 거래 2');
  await expect(page.getByTestId('j-curve')).toBeVisible();
});

test('주간 리뷰: 지난 주 거래가 있으면 카드가 뜨고, 저장하면 이번 주 한 줄로 (글은 글자 그대로)', async ({ page }) => {
  // 지난 주 수요일쯤: 이번 주 월요일 00:00 KST에서 4일 전
  const kstNow = new Date(Date.now() + 9 * 3600_000);
  const mon = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600_000 - ((kstNow.getUTCDay() + 6) % 7) * DAY;
  await seed(page, [trade('a', 104, mon - 4 * DAY)]);
  await expect(page.getByTestId('j-review')).toContainText('1거래');
  await expect(page.getByTestId('j-review-save')).toBeDisabled();
  await page.getByTestId('j-review-fix').fill('<b>손절</b> 옮기지 않기');
  await page.getByTestId('j-review-save').click();
  await expect(page.getByTestId('j-review')).toHaveCount(0);
  await expect(page.getByTestId('j-fix')).toContainText('<b>손절</b> 옮기지 않기');
  await expect(page.getByTestId('j-fix').locator('b b')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('j-fix')).toContainText('옮기지 않기');
  expect((await stored(page)).reviews).toHaveLength(1);
});

test('통계 탭: 월별 표 · 최대 낙폭, 설정 탭도 열린다', async ({ page }) => {
  await seed(page, [trade('a', 104), trade('c', 98, Date.now() - 1800_000)]);
  await page.getByTestId('j-tab-stats').click();
  await expect(page.getByTestId('j-monthly')).toContainText(kstDay(Date.now()).slice(0, 7));
  await expect(page.getByTestId('j-summary')).toContainText('최대 낙폭');
  await page.reload();
  await expect(page.getByTestId('j-monthly')).toBeVisible(); // 고른 탭을 기억
  await page.getByTestId('j-tab-settings').click();
  await expect(page.getByTestId('j-set-status')).toBeVisible();
});

test('빈 저널 · 예전 기록(칩 없음)에서도 깨지지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page, []);
  await expect(page.getByTestId('j-open')).toContainText('진행 중 0');
  await expect(page.getByTestId('j-score')).toHaveCount(0);
  await seed(page, [trade('a', 104), trade('z', 104, Date.now() - 1000, { sl: 100 })]);
  await expect(page.getByTestId('j-score')).toContainText('거래 10개부터');
  await expect(page.getByTestId('j-streak')).toContainText('0일');
  expect(errors).toEqual([]);
});

test('폰 폭 390px: 가로 스크롤 없음', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, [trade('a', 104), trade('b', null)]);
  await page.getByTestId('j-cal-toggle').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('로고를 누르면 차트(계산기) 화면으로 간다', async ({ page }) => {
  await page.goto('/journal.html');
  await expect(page.getByTestId('j-brand')).toHaveAttribute('href', '/');
  await expect(page.getByTestId('nav-chart')).toHaveAttribute('href', '/');
  await expect(page.getByTestId('journal-link')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('j-brand').click();
  await expect(page.getByTestId('brand')).toHaveAttribute('href', '/');
});
