import { expect, test, type Page } from '@playwright/test';

// 매매일지 설정 (2026-11-12 개편): 저장 버튼 없이 바로 저장 · − / + · 스위치 · 칩 편집 · 지금 상태 표시
const settings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.journal') ?? '{}').settings);
const trade = (id: string, exit: number | null, agoMin: number) => ({
  id, symbol: 'BTCUSDT', side: 'LONG', entry: 100, sl: 98, tp: 104, qty: 1, riskUsdt: 2, riskPct: 1,
  openedAt: Date.now() - (agoMin + 5) * 60_000, closedAt: exit === null ? null : Date.now() - agoMin * 60_000, exit,
  setup: '', quality: 'rule', reason: '', rules: [], feeRate: 0,
});

test.beforeEach(async ({ page }) => {
  await page.route('**/v5/market/**', (r) => r.abort());
});

async function open(page: Page, trades: unknown[] = [], size = { width: 1280, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto('/journal.html');
  await page.evaluate((t) => {
    localStorage.clear();
    localStorage.setItem('rrtool.v1.journal', JSON.stringify({ version: 1, trades: t, settings: {} }));
  }, trades);
  await page.reload();
  await page.getByTestId('j-tab-settings').click();
  await expect(page.getByTestId('j-settings')).toBeVisible();
}

test('− / + 와 직접 입력은 누르는 즉시 저장되고 「저장됨」이 뜬다 (저장 버튼 없음)', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('j-set-save')).toHaveCount(0);
  await expect(page.getByTestId('j-set-status')).toHaveText('바꾸면 바로 저장돼요');
  await expect(page.getByTestId('j-set-max')).toHaveValue('5');
  await page.getByTestId('j-set-max-plus').click();
  await page.getByTestId('j-set-max-plus').click(); // 다시 그려도 같은 버튼을 이어서 누를 수 있다
  await expect(page.getByTestId('j-set-max')).toHaveValue('7');
  await expect(page.getByTestId('j-set-status')).toContainText('저장됨');
  expect((await settings(page)).daily.maxTradesPerDay).toBe(7);
  // 직접 입력: 칸을 벗어나면 저장, 범위를 넘으면 끝값으로
  await page.getByTestId('j-set-stop').fill('99');
  await page.getByTestId('j-set-stop').blur();
  await expect(page.getByTestId('j-set-stop')).toHaveValue('20');
  expect((await settings(page)).daily.stopAfterLosses).toBe(20);
  await page.reload();
  await expect(page.getByTestId('j-set-max')).toHaveValue('7');
});

test('스위치를 끄면 0(끔)으로 저장되고 숫자 칸이 잠긴다 · 다시 켜면 전 값으로', async ({ page }) => {
  await open(page);
  await page.getByTestId('j-set-max-plus').click();
  const sw = page.getByTestId('j-set-max-on');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(page.getByTestId('j-set-max-on')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('j-set-max')).toBeDisabled();
  expect((await settings(page)).daily.maxTradesPerDay).toBe(0);
  await page.getByTestId('j-set-max-on').click();
  await expect(page.getByTestId('j-set-max')).toHaveValue('6');
  expect((await settings(page)).daily.maxTradesPerDay).toBe(6);
});

test('손실 한도: 한 번에 고르기 · 오늘 얼마나 잃었는지 옆에 보인다', async ({ page }) => {
  await open(page, [trade('a', 98, 30)]); // 오늘 −1R
  await expect(page.getByTestId('j-set-preset-normal')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('j-set-limit-day-now')).toHaveText('오늘 −1.0R / −3R');
  await page.getByTestId('j-set-preset-safe').click();
  await expect(page.getByTestId('j-set-preset-safe')).toHaveAttribute('aria-pressed', 'true');
  expect((await settings(page)).limits).toEqual({ daily: 2, weekly: 4, monthly: 8 });
  await expect(page.getByTestId('j-set-limit-day-now')).toHaveText('오늘 −1.0R / −2R');
  // 손으로 바꾸면 어느 묶음도 아니다
  await page.getByTestId('j-set-limit-day-plus').click();
  await expect(page.getByTestId('j-set-limit-day')).toHaveValue('2.5');
  await expect(page.getByTestId('j-set-preset-safe')).toHaveAttribute('aria-pressed', 'false');
});

test('목록은 칩: 버튼으로 추가 · 이름 바꾸기 · 지우고 되돌리기 (Enter 없이)', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('j-set-setups-chip')).toHaveCount(4);
  await page.getByTestId('j-set-setups-add').fill('  내 셋업  ');
  await page.getByTestId('j-set-setups-add-ok').click();
  await expect(page.getByTestId('j-set-setups-chip')).toHaveCount(5);
  await expect(page.getByTestId('j-set-setups-count')).toHaveText('5 / 30');
  expect((await settings(page)).setups).toContain('내 셋업');
  // 같은 이름은 거절하고 이유를 보여 준다
  await page.getByTestId('j-set-setups-add').fill('내 셋업');
  await page.getByTestId('j-set-setups-add-ok').click();
  await expect(page.getByTestId('j-set-setups-err')).toHaveText('이미 있는 항목이에요.');
  // 이름 바꾸기
  await page.getByTestId('j-set-setups-chip').last().locator('.js-chip-name').click();
  await page.getByTestId('j-set-setups-edit').fill('바꾼 셋업');
  await page.getByTestId('j-set-setups-edit-ok').click();
  expect((await settings(page)).setups.at(-1)).toBe('바꾼 셋업');
  // 지우기 → 되돌리기
  await page.getByTestId('j-set-setups-del-0').click();
  await expect(page.getByTestId('j-set-setups-chip')).toHaveCount(4);
  await expect(page.getByTestId('j-set-status')).toContainText('지웠어요');
  await page.getByTestId('j-set-undo').click();
  await expect(page.getByTestId('j-set-setups-chip')).toHaveCount(5);
  expect((await settings(page)).setups[0]).toBe('추세전환 눌림');
  // 진입 규칙은 8개까지
  await page.getByTestId('j-set-rules-add').fill('일곱');
  await page.getByTestId('j-set-rules-add-ok').click();
  await page.getByTestId('j-set-rules-add').fill('여덟');
  await page.getByTestId('j-set-rules-add-ok').click();
  await expect(page.getByTestId('j-set-rules-count')).toHaveText('8 / 8');
  await expect(page.getByTestId('j-set-rules-add-ok')).toBeDisabled();
});

test('위험 자동 조절: 스위치와 문장 속 숫자, 예시 금액 · 기본값으로 되돌리기', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('j-set-ar')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('j-set-ar').click();
  expect((await settings(page)).autoRisk.enabled).toBe(true);
  await expect(page.getByTestId('j-set-ar-example')).toContainText('평소 한 번에 50 USDT 위험');
  await page.getByTestId('j-set-ar-base-plus').click();
  await expect(page.getByTestId('j-set-ar-base')).toHaveValue('0.6');
  await expect(page.getByTestId('j-set-ar-example')).toContainText('평소 한 번에 60 USDT 위험');
  await page.getByTestId('j-set-reset').click();
  expect((await settings(page)).autoRisk).toEqual({ enabled: false, basePct: 0.5, upPct: 1, thresholdPct: 2 });
  await page.getByTestId('j-set-undo').click();
  expect((await settings(page)).autoRisk.basePct).toBe(0.6);
});

test('폰: 가로로 넘치지 않고 버튼이 손가락으로 누를 만큼 크다', async ({ page }) => {
  await open(page, [trade('a', 98, 30)], { width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const id of ['j-set-max-plus', 'j-set-max-on', 'j-set-setups-add-ok', 'j-set-preset-safe']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.height, id).toBeGreaterThanOrEqual(30);
    expect(b.x + b.width, id).toBeLessThanOrEqual(390);
  }
  await page.getByTestId('j-set-nav-data').click();
  await expect(page.getByTestId('j-backup')).toBeInViewport();
});
