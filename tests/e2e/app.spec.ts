import { expect, test, type Page } from '@playwright/test';
import type { BoxGeometry } from '../../src/chart/geometry';
import type { Scenario } from '../../src/core/scenario';

// 모든 E2E는 데모 데이터(DEMO-BTC, 호가 단위 0.1)로 실행한다.
type Debug = {
  getScenario(): Scenario | null;
  getRenderedGeometry(): BoxGeometry | null;
  computeExpectedGeometry(): BoxGeometry | null;
  chartClientRect(): { left: number; top: number; width: number; height: number };
  getVisibleRange(): { from: number; to: number } | null;
  getCandleCount(): number;
  getLastPrice(): number | null;
  getCountdown(): { text: string; remainingMs: number } | null;
  getHighlight(): { from: number; to: number; label: string } | null;
  isPriceAutoScale(): boolean;
  getOverlayLabels(): { profit: string | null; loss: string | null; center: string } | null;
  getLiveSnapshot(): { lastCandle: { time: number; confirmed: boolean } | null; lastPrice: { price: number; time: number } | null };
};
declare global {
  interface Window { __rrDebug: Debug }
}

async function open(page: Page, opts: { speed?: number; tf?: string } = {}) {
  await page.goto(`/?source=demo&demoSpeed=${opts.speed ?? 1}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  if (opts.tf) await page.getByTestId('tf').selectOption(opts.tf);
  await waitLive(page);
}

async function waitLive(page: Page) {
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
}

const scenario = (page: Page) => page.evaluate(() => window.__rrDebug.getScenario());
const rendered = (page: Page) => page.evaluate(() => window.__rrDebug.getRenderedGeometry());
const chartRect = (page: Page) => page.evaluate(() => window.__rrDebug.chartClientRect());
const visibleRange = (page: Page) => page.evaluate(() => window.__rrDebug.getVisibleRange());

async function setLevel(page: Page, which: 'sl' | 'tp', value: string) {
  const input = page.getByTestId(`${which}-input`);
  await input.fill(value);
  await input.press('Enter');
}

/** LONG 생성 후 SL = 엔트리 − 10, TP = 엔트리 + 30 (RR 1:3)로 맞춘다 */
async function validLong(page: Page): Promise<Scenario> {
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  await setLevel(page, 'sl', (s.entry - 10).toFixed(1));
  await setLevel(page, 'tp', (s.entry + 30).toFixed(1));
  await expect(page.getByTestId('rr')).toHaveText('1:3');
  await expect.poll(() => rendered(page)).not.toBeNull();
  return (await scenario(page))!;
}

test('entry stays fixed while price moves', async ({ page }) => {
  await open(page, { speed: 60, tf: '1' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s0 = (await scenario(page))!;
  const candles0 = await page.evaluate(() => window.__rrDebug.getCandleCount());
  const price0 = await page.evaluate(() => window.__rrDebug.getLastPrice());
  await expect(page.getByTestId('entry-price')).toHaveText(s0.entry.toFixed(1));

  await page.waitForTimeout(3_000); // 60배속: 데모 시간 3분, 새 1분봉 약 3개

  const s1 = (await scenario(page))!;
  expect(await page.evaluate(() => window.__rrDebug.getCandleCount())).toBeGreaterThan(candles0);
  expect(await page.evaluate(() => window.__rrDebug.getLastPrice())).not.toBe(price0);
  expect(s1.entry).toBe(s0.entry);
  expect(s1.auto).toEqual(s0.auto);
  expect(s1.applied).toEqual(s0.applied);
  await expect(page.getByTestId('entry-price')).toHaveText(s0.entry.toFixed(1));
});

test('dragging SL updates RR during drag and keeps TP', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page);
  const g = (await rendered(page))!;
  const r = await chartRect(page);
  const x = r.left + (g.x1 + g.x2) / 2;
  const y = r.top + g.ySl!;
  const rangeBefore = await visibleRange(page);

  await page.mouse.move(x, y);
  await page.mouse.down();
  // 대각선으로 끈다: 가드가 없으면 차트가 가로로 이동해 visibleRange가 바뀐다
  await page.mouse.move(x + 120, y + 40, { steps: 6 });
  // 버튼을 누른 채로(드래그 중) 확인
  await expect(page.getByTestId('rr')).not.toHaveText('1:3');
  const during = (await scenario(page))!;
  expect(during.applied.tp).toBe(s.applied.tp);
  expect(during.applied.sl!).toBeLessThan(s.applied.sl!);
  expect(during.entry).toBe(s.entry);
  await page.mouse.up();

  const after = (await scenario(page))!;
  expect(after.source).toEqual({ sl: 'manual', tp: 'manual' });
  await expect(page.getByTestId('sl-source')).toHaveText('수동 수정');
  expect(await visibleRange(page)).toEqual(rangeBefore); // 드래그가 차트를 이동시키지 않음
});

test('geometry matches coordinates after zoom and scroll', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  const r = await chartRect(page);
  const before = await visibleRange(page);

  await page.mouse.move(r.left + 80, r.top + r.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(r.left + 330, r.top + r.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  expect(await visibleRange(page)).not.toEqual(before);
  const drawn = (await rendered(page))!;
  const expected = (await page.evaluate(() => window.__rrDebug.computeExpectedGeometry()))!;
  for (const k of ['x1', 'x2', 'yEntry', 'ySl', 'yTp'] as const) {
    expect(Math.abs((drawn[k] as number) - (expected[k] as number))).toBeLessThan(0.5);
  }
});

test('SHORT draws profit below entry', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-short').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  await setLevel(page, 'sl', (s.entry + 10).toFixed(1));
  await setLevel(page, 'tp', (s.entry - 30).toFixed(1));
  await expect(page.getByTestId('rr')).toHaveText('1:3');
  const g = (await rendered(page))!;
  expect(g.profit!.y).toBeGreaterThanOrEqual(g.yEntry - 0.5);
  expect(g.loss!.y + g.loss!.h).toBeLessThanOrEqual(g.yEntry + 0.5);
});

test('reload restores scenario and manual edits', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  const before = (await scenario(page))!;
  await page.reload();
  await waitLive(page);
  expect(await scenario(page)).toEqual(before);
  await expect(page.getByTestId('sl-source')).toHaveText('수동 수정');
  await expect.poll(() => rendered(page)).not.toBeNull();
  await expect(page.getByTestId('tf')).toHaveValue('15');
});

test('restore auto returns creation values', async ({ page }) => {
  await open(page, { tf: '15' });
  const edited = await validLong(page);
  await page.getByTestId('btn-restore').click();
  const s = (await scenario(page))!;
  expect(s.applied).toEqual({ sl: edited.auto.sl.price, tp: edited.auto.tp.price });
  expect(s.source).toEqual({ sl: 'auto', tp: 'auto' });
  expect(s.entry).toBe(edited.entry);
  expect(s.auto).toEqual(edited.auto);
});

test('disconnect blocks creation and reconnect recovers', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-disconnect').click();
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'disconnected');
  await expect(page.getByTestId('btn-long')).toBeDisabled();
  await expect(page.getByTestId('btn-short')).toBeDisabled();
  await waitLive(page);
});

test('second LONG asks instead of overwriting', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page);
  await page.getByTestId('btn-short').click();
  await expect(page.getByTestId('dialog')).toBeVisible();
  await expect(page.getByTestId('dialog')).toContainText('활성 시나리오');
  await page.getByTestId('dialog-cancel').click();
  await expect(page.getByTestId('dialog')).toBeHidden();
  const after = (await scenario(page))!;
  expect(after.id).toBe(s.id);
  expect(after.side).toBe('LONG');
});

test('closing then pressing LONG creates a new scenario', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page);
  await page.getByTestId('btn-short').click();
  await page.getByTestId('dialog-close-scenario').click();
  await expect(page.getByTestId('dialog')).toBeHidden();
  expect((await scenario(page))!.status).toBe('closed');
  await page.getByTestId('btn-short').click();
  await expect.poll(async () => (await scenario(page))?.id).not.toBe(s.id);
  expect((await scenario(page))!.side).toBe('SHORT');
});

test('manual input snaps to tick', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  const raw = s.entry - 12.34567;
  const snapped = Number((Math.round(raw / 0.1) * 0.1).toFixed(1));
  await setLevel(page, 'sl', String(raw));
  await expect(page.getByTestId('sl-input')).toHaveValue(snapped.toFixed(1));
  expect((await scenario(page))!.applied.sl).toBe(snapped);
});

test('switching symbol hides scenario', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  const symbol = page.getByTestId('symbol');
  await symbol.fill('DEMO-ETH');
  await symbol.press('Enter');
  await waitLive(page);
  await expect(page.getByTestId('other-symbol-banner')).toContainText('DEMO-BTC');
  await expect.poll(() => rendered(page)).toBeNull();
  await symbol.fill('DEMO-BTC');
  await symbol.press('Enter');
  await waitLive(page);
  await expect(page.getByTestId('other-symbol-banner')).toBeHidden();
  await expect.poll(() => rendered(page)).not.toBeNull();
});

async function setSlMode(page: Page, mode: string) {
  const details = page.locator('details.settings');
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator('summary').click();
  await page.getByTestId('setting-slMode').selectOption(mode);
}

test('default SL uses the chart timeframe, so the SL timeframe box is locked to it', async ({ page }) => {
  await open(page, { tf: '15' });
  const sltf = page.getByTestId('sltf');
  await expect(sltf).toBeDisabled();
  await expect(sltf).toHaveValue('15');
  await page.getByTestId('tf').selectOption('240');
  await waitLive(page);
  await expect(sltf).toHaveValue('240');
});

test('LONG on a 4H chart uses the latest confirmed 4H swing low', async ({ page }) => {
  await open(page, { tf: '240' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  const H4 = 4 * 3600_000;
  expect(s.auto.sl.method).toBe('swing');
  expect(s.auto.sl.timeframe).toBe('240');
  expect(s.auto.sl.status).toBe('ok');
  const c = s.auto.sl.candle!;
  expect(c.time % H4).toBe(0);
  expect(c.time + 3 * H4).toBeLessThanOrEqual(s.priceTime); // 오른쪽 2봉까지 마감돼야 확정
  expect(s.auto.sl.price).toBe(c.low);
  expect(s.auto.sl.price!).toBeLessThan(s.entry);
  await expect(page.getByTestId('sl-rationale')).toContainText('4시간봉 최근 확정 스윙 저점');
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getHighlight()?.label ?? null)).toBe('SL 기준 스윙 저점');
});

test('previous-candle SL mode: SL timeframe defaults one frame up and follows the chart timeframe', async ({ page }) => {
  await open(page, { tf: '15' });
  await setSlMode(page, 'prevCandle');
  const sltf = page.getByTestId('sltf');
  await expect(sltf).toBeEnabled();
  await expect(sltf).toHaveValue('240');
  await page.getByTestId('tf').selectOption('240');
  await waitLive(page);
  await expect(sltf).toHaveValue('720');
  await page.getByTestId('tf').selectOption('D');
  await waitLive(page);
  await expect(sltf).toHaveValue('W');
  await sltf.selectOption('D'); // 사용자가 바꾼 값과 SL 방식은 새로고침 뒤에도 유지
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId('sltf')).toHaveValue('D');
  await expect(page.getByTestId('sltf')).toBeEnabled();
});

test('previous-candle SL mode uses the previous closed candle of the SL timeframe', async ({ page }) => {
  await open(page, { tf: '15' });
  await setSlMode(page, 'prevCandle');
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  const H4 = 4 * 3600_000;
  expect(s.auto.sl.method).toBe('prevCandle');
  expect(s.auto.sl.timeframe).toBe('240');
  expect(s.auto.sl.candle!.time).toBe(Math.floor(s.priceTime / H4) * H4 - H4);
  await expect(page.getByTestId('sl-rationale')).toContainText('4시간봉 직전 마감 봉');
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getHighlight()?.label ?? null)).toBe('SL 기준 4시간봉');
});

test('Alt+R resets the chart view like TradingView', async ({ page }) => {
  await open(page, { tf: '15' });
  const r = await chartRect(page);
  const n = await page.evaluate(() => window.__rrDebug.getCandleCount());
  const initial = (await visibleRange(page))!;
  expect(initial.to).toBeCloseTo(n + 24, 0);
  // 가격축을 끌어 자동 맞춤을 끄고, 차트를 옆으로 끈다
  const axisX = r.left + r.width - 25;
  await page.mouse.move(axisX, r.top + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(axisX, r.top + r.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(r.left + r.width / 2, r.top + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.left + r.width / 2 + 300, r.top + r.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__rrDebug.isPriceAutoScale())).toBe(false);
  expect((await visibleRange(page))!.to).toBeLessThan(n);
  await page.keyboard.press('Alt+KeyR');
  await expect.poll(async () => (await visibleRange(page))!.to).toBeCloseTo(n + 24, 0);
  expect((await visibleRange(page))!.from).toBeCloseTo(initial.from, 0);
  expect(await page.evaluate(() => window.__rrDebug.isPriceAutoScale())).toBe(true);
});

test('price axis shows a countdown to the bar close that ticks down', async ({ page }) => {
  await open(page, { tf: '1' });
  const read = () => page.evaluate(() => window.__rrDebug.getCountdown());
  await expect.poll(read).not.toBeNull();
  const a = (await read())!;
  expect(a.text).toMatch(/^\d{2}:\d{2}$/);
  expect(a.remainingMs).toBeLessThanOrEqual(60_000);
  await page.waitForTimeout(2_100);
  const b = (await read())!;
  expect(b.text).not.toBe(a.text);
});

test('clicking a percent line sets TP or SL to that level', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s0 = (await scenario(page))!;
  // 기존 SL·TP 선이 점선 클릭을 가로채지 않도록 화면 밖으로 치운다
  await setLevel(page, 'sl', (s0.entry * 0.8).toFixed(1));
  await setLevel(page, 'tp', (s0.entry * 1.2).toFixed(1));
  await expect.poll(async () => (await rendered(page))?.presets.length ?? 0).toBe(6);
  const g = (await rendered(page))!;
  const r = await chartRect(page);
  const x = r.left + (g.x1 + g.x2) / 2;
  const plus1 = g.presets.find((p) => p.pct === 1)!;
  const minus1 = g.presets.find((p) => p.pct === -1)!;
  expect(plus1.target).toBe('tp');
  expect(minus1.target).toBe('sl');
  expect(plus1.y).toBeGreaterThan(0);
  expect(minus1.y).toBeLessThan(r.height);

  const rangeBefore = await visibleRange(page);
  await page.mouse.click(x, r.top + plus1.y);
  await expect.poll(async () => (await scenario(page))!.applied.tp).toBe(plus1.price);
  await page.mouse.click(x, r.top + minus1.y);
  await expect.poll(async () => (await scenario(page))!.applied.sl).toBe(minus1.price);
  await expect(page.getByTestId('rr')).toHaveText('1:1');
  expect((await scenario(page))!.entry).toBe(s0.entry);
  expect(await visibleRange(page)).toEqual(rangeBefore); // 클릭이 차트를 움직이지 않음
});

test('dragging the box body moves it sideways without touching prices or the chart', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const e = (await scenario(page))!.entry;
  // 몸통을 잡을 수 있을 만큼 넓게: SL −1.5%, TP +2%
  await setLevel(page, 'sl', (e * 0.985).toFixed(1));
  await setLevel(page, 'tp', (e * 1.02).toFixed(1));
  await expect.poll(async () => { const g = await rendered(page); return !!(g?.profit && g?.loss); }).toBe(true);
  const s0 = (await scenario(page))!;
  const g = (await rendered(page))!;
  const r = await chartRect(page);
  // 몸통 안(화면 안)에서 SL·TP·점선과 떨어진 높이를 고른다
  const lines = [g.ySl!, g.yTp!, ...g.presets.map((p) => p.y)];
  const top = Math.max(0, Math.min(g.profit!.y, g.loss!.y)) + 2;
  const bottom = Math.min(r.height, Math.max(g.profit!.y + g.profit!.h, g.loss!.y + g.loss!.h)) - 2;
  let y = top;
  while (y < bottom && lines.some((l) => Math.abs(l - y) < 10)) y += 2;
  expect(y).toBeLessThan(bottom);
  const x = g.x1 + 12;
  const rangeBefore = await visibleRange(page);

  await page.mouse.move(r.left + x, r.top + y);
  await page.mouse.down();
  await page.mouse.move(r.left + x + 100, r.top + y, { steps: 8 });
  await page.mouse.up();

  const moved = (await rendered(page))!;
  expect(moved.x1 - g.x1).toBeGreaterThan(80);
  expect(moved.x1 - g.x1).toBeLessThan(120);
  expect(moved.x2 - moved.x1).toBeCloseTo(g.x2 - g.x1, 0);
  const s1 = (await scenario(page))!;
  expect(s1.boxShiftMs).toBeGreaterThan(0);
  expect(s1.entry).toBe(s0.entry);
  expect(s1.applied).toEqual(s0.applied);
  expect(await visibleRange(page)).toEqual(rangeBefore);

  await page.reload();
  await waitLive(page);
  await expect.poll(async () => (await rendered(page))?.x1 ?? 0).toBeCloseTo(moved.x1, 0);
});

test('the box stops before it leaves the visible chart', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const e = (await scenario(page))!.entry;
  await setLevel(page, 'sl', (e * 0.985).toFixed(1));
  await setLevel(page, 'tp', (e * 1.02).toFixed(1));
  await expect.poll(async () => { const g = await rendered(page); return !!(g?.profit && g?.loss); }).toBe(true);
  const g = (await rendered(page))!;
  const r = await chartRect(page);
  const lines = [g.ySl!, g.yTp!, ...g.presets.map((p) => p.y)];
  let y = Math.max(0, Math.min(g.profit!.y, g.loss!.y)) + 2;
  while (lines.some((l) => Math.abs(l - y) < 10)) y += 2;
  await page.mouse.move(r.left + g.x1 + 12, r.top + y);
  await page.mouse.down();
  await page.mouse.move(r.left + r.width - 5, r.top + y, { steps: 10 }); // 가격축 너머까지 끈다
  await page.mouse.up();
  const moved = (await rendered(page))!;
  const paneWidth = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid=chart] canvas') as HTMLCanvasElement;
    return canvas.getBoundingClientRect().width;
  });
  expect(moved.x1).toBeLessThanOrEqual(paneWidth - 50);
});

test('labels show price and percent only, no tick counts', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  const labels = (await page.evaluate(() => window.__rrDebug.getOverlayLabels()))!;
  expect(labels.profit).toMatch(/^목표 \+[\d.]+ \([\d.]+%\)$/);
  expect(labels.loss).toMatch(/^손절 −[\d.]+ \([\d.]+%\)$/);
  await expect(page.locator('.card .metrics').first()).not.toContainText('틱');
});

test('monthly chart: candles start on the 1st and the countdown runs to the month end', async ({ page }) => {
  await open(page, { tf: 'M' });
  await expect(page.getByTestId('tf')).toHaveValue('M');
  await expect(page.getByTestId('htf')).toHaveValue('');
  const snap = await page.evaluate(() => window.__rrDebug.getLiveSnapshot());
  const start = new Date(snap.lastCandle!.time);
  expect([start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes()]).toEqual([1, 0, 0]);
  expect(snap.lastCandle!.confirmed).toBe(false);
  const monthEnd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getCountdown())).not.toBeNull();
  const cd = (await page.evaluate(() => window.__rrDebug.getCountdown()))!;
  expect(Math.abs(snap.lastPrice!.time + cd.remainingMs - monthEnd)).toBeLessThan(5_000);
  if (cd.remainingMs >= 86_400_000) expect(cd.text).toMatch(/^\d+d \d+h$/);
});

test('split entries: 3 or 5 splits between entry and SL, loss at SL capped at the risk %', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page); // SL = 엔트리 − 10, TP = 엔트리 + 30
  await page.getByTestId('sizing-capital').fill('10,000');
  await page.getByTestId('sizing-capital').press('Enter');
  await expect(page.getByTestId('sizing-row')).toHaveCount(3);
  const prices = async () =>
    (await page.getByTestId('sizing-row').locator('td:nth-child(2)').allTextContents()).map(Number);
  const expected = (n: number) => Array.from({ length: n }, (_, k) => Number((s.entry - (k / n) * 10).toFixed(1)));
  expect(await prices()).toEqual(expected(3));
  const money = async () =>
    (await page.getByTestId('sizing-row').locator('td:nth-child(3)').allTextContents()).map((t) => Number(t.replace(/,/g, '')));
  const m3 = await money();
  expect(m3[0]).toBeLessThan(m3[1]);
  expect(m3[1]).toBeLessThan(m3[2]);
  const summary = page.getByTestId('sizing-summary');
  const loss = Number((await summary.locator('dd').nth(2).textContent())!.match(/−([\d,.]+)/)![1].replace(/,/g, ''));
  expect(loss).toBeLessThanOrEqual(100);
  expect(loss).toBeGreaterThan(99);
  await expect.poll(async () => (await rendered(page))?.splits.map((x) => x.label.split(' ')[0]) ?? []).toEqual(['2차', '3차']);
  const g = (await rendered(page))!;
  for (const sp of g.splits) {
    expect(sp.y).toBeGreaterThan(g.yEntry);
    expect(sp.y).toBeLessThan(g.ySl!);
  }

  await page.getByTestId('sizing-splits').selectOption('5');
  await expect(page.getByTestId('sizing-row')).toHaveCount(5);
  expect(await prices()).toEqual(expected(5));
  await expect.poll(async () => (await rendered(page))?.splits.length ?? 0).toBe(4);

  // SL을 옮기면 분할 가격도 따라간다
  await setLevel(page, 'sl', (s.entry - 20).toFixed(1));
  await expect.poll(async () => (await prices())[1]).toBe(Number((s.entry - 4).toFixed(1)));

  // 입력값은 새로고침 뒤에도 남는다
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId('sizing-capital')).toHaveValue('10000');
  await expect(page.getByTestId('sizing-splits')).toHaveValue('5');
  await expect(page.getByTestId('sizing-row')).toHaveCount(5);
});

test('split entries ask for the capital first', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  await expect(page.getByTestId('sizing-reason')).toContainText('운영자산');
  await expect(page.getByTestId('sizing-table')).toBeHidden();
});
