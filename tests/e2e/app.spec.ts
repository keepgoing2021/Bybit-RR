import { expect, test, type Page } from '@playwright/test';
import type { BoxGeometry } from '../../src/chart/geometry';
import type { Scenario } from '../../src/core/scenario';

// 모든 E2E는 데모 데이터(DEMO-BTC, 호가 단위 0.1)로 실행한다.
type Debug = {
  getScenario(): Scenario | null;
  getLastCopied(): string | null;
  timeToX(ms: number): number | null;
  isBoxSelected(): boolean;
  wickColors(): { up: string; down: string };
  getLegend(): { index: number | null; stats: { time: number; close: number; changePct: number; amplitudePct: number } | null; text: string };
  priceToClientY(p: number): number | null;
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
  getMaLast(): { label: string; time: number; value: number }[];
  getRecentCloses(n: number): number[];
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
  await expect(page.getByTestId('rr-input')).toHaveValue('3');
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
  await expect(page.getByTestId('entry-input')).toHaveValue(s0.entry.toFixed(1));

  await page.waitForTimeout(3_000); // 60배속: 데모 시간 3분, 새 1분봉 약 3개

  const s1 = (await scenario(page))!;
  expect(await page.evaluate(() => window.__rrDebug.getCandleCount())).toBeGreaterThan(candles0);
  expect(await page.evaluate(() => window.__rrDebug.getLastPrice())).not.toBe(price0);
  expect(s1.entry).toBe(s0.entry);
  expect(s1.auto).toEqual(s0.auto);
  expect(s1.applied).toEqual(s0.applied);
  await expect(page.getByTestId('entry-input')).toHaveValue(s0.entry.toFixed(1));
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
  await expect(page.getByTestId('rr-input')).not.toHaveValue('3');
  const during = (await scenario(page))!;
  expect(during.applied.tp).toBe(s.applied.tp);
  expect(during.applied.sl!).toBeLessThan(s.applied.sl!);
  expect(during.entry).toBe(s.entry);
  await page.mouse.up();

  const after = (await scenario(page))!;
  expect(after.source).toEqual({ sl: 'manual', tp: 'manual' });
  await expect(page.getByTestId('sl-source')).toHaveText('수동');
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
  await expect(page.getByTestId('rr-input')).toHaveValue('3');
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
  await expect(page.getByTestId('sl-source')).toHaveText('수동');
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

test('pressing SHORT after LONG recalculates right away at the current price (no dialog)', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page);
  await page.getByTestId('btn-short').click();
  await expect.poll(async () => (await scenario(page))?.id).not.toBe(s.id);
  const after = (await scenario(page))!;
  expect(after.side).toBe('SHORT');
  expect(after.source).toEqual({ sl: 'auto', tp: 'auto' });
  expect(Math.abs(after.entry - (await page.evaluate(() => window.__rrDebug.getLastPrice()))!)).toBeLessThan(after.entry * 0.002);
  await expect(page.locator('[role=dialog]')).toHaveCount(0);
});

test('clear removes the calculation from the panel and the chart', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  await page.getByTestId('btn-clear').click();
  expect(await scenario(page)).toBeNull();
  await expect.poll(() => rendered(page)).toBeNull();
  await expect(page.locator('.empty')).toBeVisible();
});

test('entry can be typed for a limit order; restore goes back to the clicked price', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page); // SL = 진입 − 10, TP = 진입 + 30
  const limit = (s.entry - 5).toFixed(1);
  await page.getByTestId('entry-input').fill(limit);
  await page.getByTestId('entry-input').press('Enter');
  await expect(page.getByTestId('entry-source')).toHaveText('지정가');
  await expect(page.getByTestId('rr-input')).toHaveValue('7'); // 보상 35 ÷ 위험 5
  expect((await scenario(page))!.entry).toBe(Number(limit));
  await expect.poll(async () => (await rendered(page))?.yEntry).toBeCloseTo(
    (await page.evaluate((p) => window.__rrDebug.priceToClientY(p), Number(limit)))! - (await chartRect(page)).top, 0,
  );
  await page.getByTestId('btn-restore').click();
  expect((await scenario(page))!.entry).toBe(s.entry);
  await expect(page.getByTestId('entry-source')).toHaveText('시장가');
});

test('no live monitoring readouts: only the calculation is shown', async ({ page }) => {
  await open(page, { speed: 60, tf: '1' });
  await validLong(page);
  for (const t of ['현재가', '현재 손익률', 'R 배수', '진행 중', '종료']) await expect(page.locator('.card')).not.toContainText(t);
  await expect.poll(async () => (await page.evaluate(() => window.__rrDebug.getOverlayLabels()))?.center).toBe('손익비 1:3');
  await page.waitForTimeout(1_500); // 가격이 움직여도 중앙 이름표는 그대로
  expect((await page.evaluate(() => window.__rrDebug.getOverlayLabels()))!.center).toBe('손익비 1:3');
});

test('order table numbers copy on click', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  await page.getByTestId('sizing-capital').fill('10000');
  await page.getByTestId('sizing-capital').press('Enter');
  const qty = page.getByTestId('sizing-row').first().locator('td:nth-child(4) [data-testid=copy]');
  const text = (await qty.textContent())!;
  await qty.click();
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getLastCopied())).toBe(text);
  await expect(page.getByTestId('toast')).toContainText(text);
  const money = page.getByTestId('sizing-row').first().locator('td:nth-child(3) [data-testid=copy]');
  await money.click();
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getLastCopied())).toBe((await money.textContent())!.replace(/,/g, ''));
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

test('switching symbol clears the calculation', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  const symbol = page.getByTestId('symbol');
  await symbol.fill('DEMO-ETH');
  await symbol.press('Enter');
  await waitLive(page);
  expect(await scenario(page)).toBeNull();
  await expect.poll(() => rendered(page)).toBeNull();
  await symbol.fill('DEMO-BTC');
  await symbol.press('Enter');
  await waitLive(page);
  expect(await scenario(page)).toBeNull();
});

async function setSetting(page: Page, key: string, value: string) {
  const details = page.locator('details.settings');
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator('summary').click();
  const control = page.getByTestId(`setting-${key}`);
  await control.fill(value);
  await control.press('Enter');
  await control.blur();
}

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

test('no TP 기준: TP starts at RR 1:1.5 from the auto SL and can be changed in settings', async ({ page }) => {
  await open(page, { tf: '240' });
  await expect(page.getByTestId('htf')).toHaveCount(0);
  await expect(page.locator('header.topbar')).not.toContainText('TP 기준');
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  expect(s.auto.sl.status).toBe('ok');
  expect(s.auto.tp.rr).toBe(1.5);
  expect(s.applied.tp).toBe(Number((s.entry + 1.5 * (s.entry - s.applied.sl!)).toFixed(1)));
  await expect(page.getByTestId('rr-input')).toHaveValue('1.5');
  await expect(page.getByTestId('tp-rationale')).toContainText('기본 손익비 1:1.5');
  await expect(page.locator('.card')).not.toContainText('스윙 고점');

  await setSetting(page, 'defaultRR', '2');
  await page.getByTestId('btn-long').click();
  await expect.poll(async () => (await scenario(page))?.auto.tp.rr).toBe(2);
  await expect(page.getByTestId('rr-input')).toHaveValue('2');
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

/** 화면 기준으로 1R이 px 픽셀이 되도록 SL을 둔다 (가격축 배율은 실행마다 다르다). TP는 점선을 가리지 않게 멀리 */
async function riskInPixels(page: Page, s: Scenario, px: number): Promise<number> {
  const [y0, y1] = await page.evaluate(([a, b]) => [window.__rrDebug.priceToClientY(a), window.__rrDebug.priceToClientY(b)], [s.entry, s.entry + 100]);
  const risk = Number(((px * 100) / (y0! - y1!)).toFixed(1));
  await setLevel(page, 'sl', (s.entry - risk).toFixed(1));
  await setLevel(page, 'tp', (s.entry + risk * 10).toFixed(1));
  return risk;
}

/** 차트 안에 보이는 손익비 점선 */
async function visiblePresets(page: Page) {
  const g = (await rendered(page))!;
  const r = await chartRect(page);
  return { g, r, shown: g.presets.filter((p) => p.y > 12 && p.y < r.height - 12) };
}

test('RR lines replace the percent lines; clicking one moves TP to that RR', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s0 = (await scenario(page))!;
  const risk = await riskInPixels(page, s0, 30);
  await expect.poll(async () => (await rendered(page))?.presets.length ?? 0).toBeGreaterThan(2);
  const { g, r, shown } = await visiblePresets(page);
  // 퍼센트 점선은 없고 손익비 점선만, 엔트리에서 바깥쪽 순서
  const all = ['1:1', '1:1.3', '1:1.5', '1:1.7', '1:2', '1:2.5', '1:3'];
  const labels = g.presets.map((p) => p.label);
  expect(labels.every((l) => all.includes(l))).toBe(true);
  expect(labels).toEqual([...labels].sort((a, b) => all.indexOf(a) - all.indexOf(b)));
  expect(labels[0]).toBe('1:1');
  expect(g.presets.every((p) => p.target === 'tp')).toBe(true);
  const pick = shown.find((p) => p.label !== '1:1') ?? shown[0];
  const rangeBefore = await visibleRange(page);
  await page.mouse.click(r.left + (g.x1 + g.x2) / 2, r.top + pick.y);
  await expect.poll(async () => (await scenario(page))!.applied.tp).toBe(pick.price);
  await expect(page.getByTestId('rr-input')).toHaveValue(pick.label.slice(2));
  const s1 = (await scenario(page))!;
  expect(s1.entry).toBe(s0.entry);
  expect(s1.applied.sl).toBe(Number((s0.entry - risk).toFixed(1)));
  expect(await visibleRange(page)).toEqual(rangeBefore); // 클릭이 차트를 움직이지 않음
});

test('RR looks editable: red box with a pencil, and chart chips say what a click does', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  await riskInPixels(page, s, 30);
  const edit = page.getByTestId('rr-edit');
  await expect(edit).toContainText('✎');
  await expect(page.getByTestId('rr-hint')).toContainText('1:x 칩');
  expect(await edit.locator('.edit-icon').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  expect(await page.getByTestId('rr-input').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(240, 97, 109)');
  expect(await edit.locator('.rr-head').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  expect(await edit.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
  await expect.poll(async () => (await visiblePresets(page)).shown.length).toBeGreaterThan(0);
  const { g, r, shown } = await visiblePresets(page);
  const chip = shown[shown.length - 1];
  await page.mouse.move(r.left + g.x2 - 20, r.top + chip.y + 6); // 칩 위: 선보다 넓게 잡힌다
  await expect(page.getByTestId('chart')).toHaveAttribute('title', new RegExp(`누르면 TP를 손익비 ${chip.label}`));
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await scenario(page))!.applied.tp).toBe(chip.price);
});

test('typing an RR moves TP to that RR, keeping entry and SL', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page); // SL = 진입 − 10
  const rr = page.getByTestId('rr-input');
  await rr.fill('1.7');
  await rr.press('Enter');
  await expect.poll(async () => (await scenario(page))!.applied.tp).toBe(Number((s.entry + 17).toFixed(1)));
  await expect(rr).toHaveValue('1.7');
  await expect(page.getByTestId('tp-source')).toHaveText('수동');
  const after = (await scenario(page))!;
  expect(after.entry).toBe(s.entry);
  expect(after.applied.sl).toBe(s.applied.sl);
  await expect.poll(async () => (await rendered(page))?.yTp).toBeCloseTo(
    (await page.evaluate((p) => window.__rrDebug.priceToClientY(p), after.applied.tp!))! - (await chartRect(page)).top, 0,
  );
  await rr.fill('1:2.5'); // 1:X 형태도 받는다
  await rr.press('Enter');
  await expect.poll(async () => (await scenario(page))!.applied.tp).toBe(Number((s.entry + 25).toFixed(1)));
  await rr.fill('abc');
  await rr.press('Enter');
  await expect(page.getByTestId('toast')).toContainText('손익비는 0보다 큰 숫자');
  await expect(rr).toHaveValue('2.5');
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
  expect(s1.boxShiftBars).toBeGreaterThan(s0.boxShiftBars!);
  expect(s1.entry).toBe(s0.entry);
  expect(s1.applied).toEqual(s0.applied);
  expect(await visibleRange(page)).toEqual(rangeBefore);

  await page.reload();
  await waitLive(page);
  await expect.poll(async () => (await rendered(page))?.x1 ?? 0).toBeCloseTo(moved.x1, 0);
});

test('a new calculation starts the box 2 bars right of the entry bar, also after changing timeframe', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  expect(s.boxShiftBars).toBe(2);
  const offsetInBars = async (tfMin: number) => {
    const g = (await rendered(page))!;
    const bar = Math.floor(s.priceTime / (tfMin * 60_000)) * tfMin * 60_000; // 진입이 속한 봉
    const [x0, x1] = await page.evaluate(([a, b]) => [window.__rrDebug.timeToX(a), window.__rrDebug.timeToX(b)], [bar - tfMin * 60_000, bar]);
    return (g.x1 - x1!) / (x1! - x0!);
  };
  await expect.poll(() => offsetInBars(15)).toBeCloseTo(2, 1);
  await page.getByTestId('tf').selectOption('1');
  await waitLive(page);
  await expect.poll(async () => (await rendered(page)) !== null).toBe(true);
  await expect.poll(() => offsetInBars(1)).toBeCloseTo(2, 1);
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
  const loss = Number((await summary.getByTestId('sizing-loss').textContent())!.match(/−([\d,.]+)/)![1].replace(/,/g, ''));
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

test('MA20 and MA100 lines follow the live candle', async ({ page }) => {
  await open(page, { speed: 60, tf: '1' });
  await expect(page.getByTestId('ma-legend')).toContainText('MA20');
  await expect(page.getByTestId('ma-legend')).toContainText('MA100');
  const check = async () => {
    const [ma, closes, snap] = await page.evaluate(() => [
      window.__rrDebug.getMaLast(), window.__rrDebug.getRecentCloses(100), window.__rrDebug.getLiveSnapshot(),
    ] as const);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(ma.map((m) => m.label)).toEqual(['MA20', 'MA100']);
    expect(ma[0].time).toBe(snap.lastCandle!.time);
    expect(ma[1].time).toBe(snap.lastCandle!.time);
    return { ma20: ma[0].value, ma100: ma[1].value, exp20: mean(closes.slice(-20)), exp100: mean(closes), t: ma[0].time };
  };
  // 실시간으로 값이 바뀌는 중이라 같은 순간에 읽은 값끼리 비교한다
  const a = await check();
  expect(a.ma20).toBeCloseTo(a.exp20, 6);
  expect(a.ma100).toBeCloseTo(a.exp100, 6);
  // 배속 60: 1초에 1분봉 하나 → 새 봉에서도 MA가 따라온다
  await expect.poll(async () => (await check()).t, { timeout: 10_000 }).toBeGreaterThan(a.t);
  const b = await check();
  expect(b.ma20).toBeCloseTo(b.exp20, 6);
});

test('capital and split inputs live in the top bar, even before a scenario exists', async ({ page }) => {
  await open(page, { tf: '15' });
  const bar = page.locator('header.topbar');
  for (const id of ['sizing-capital', 'sizing-risk', 'sizing-splits', 'sizing-weights']) await expect(bar.getByTestId(id)).toBeVisible();
  await bar.getByTestId('sizing-capital').fill('5000');
  await bar.getByTestId('sizing-capital').press('Enter');
  await bar.getByTestId('sizing-splits').selectOption('5');
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s = (await scenario(page))!;
  await setLevel(page, 'sl', (s.entry - 10).toFixed(1));
  await expect(page.locator('.panel').getByTestId('sizing-row')).toHaveCount(5);
  await expect(page.locator('.panel').getByTestId('sizing-capital')).toHaveCount(0);
});

const finalAvgY = async (page: Page) => {
  const g = await rendered(page);
  return g ? g.avgLines.find((a) => a.final)?.y ?? null : 'no box';
};

test('average entry at each fill stage: table column, emphasized all-filled row, distinct chart lines, toggle', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page); // SL −10
  await page.getByTestId('sizing-capital').fill('10000');
  await page.getByTestId('sizing-capital').press('Enter');
  const avgCell = page.getByTestId('sizing-avg');
  await expect(avgCell).not.toHaveText('');
  await expect(page.getByTestId('sizing-summary')).toContainText('전부 체결 시 예상 평단');
  expect(await avgCell.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700');
  expect(await avgCell.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  const s = (await scenario(page))!;

  // 표: 1차 = 진입가, 뒤로 갈수록 평단이 SL 쪽으로, 마지막 = 전부 체결 평단
  const stage = (await page.getByTestId('stage-avg').allTextContents()).map(Number);
  expect(stage).toHaveLength(3);
  expect(stage[0]).toBe(s.entry);
  expect(stage[1]).toBeLessThan(stage[0]);
  expect(stage[2]).toBeLessThan(stage[1]);
  expect(stage[2]).toBe(Number(await avgCell.textContent()));

  // 차트: 2차 체결 시·전부 체결 시 두 선, 값은 표와 같다
  await expect.poll(async () => (await rendered(page))?.avgLines.length ?? 0).toBe(2);
  const lines = (await rendered(page))!.avgLines;
  expect(lines.map((l) => l.final)).toEqual([false, true]);
  expect(lines.map((l) => l.price)).toEqual([stage[1], stage[2]]);
  expect(lines[0].label).toBe(`2차 체결 시 평단 ${stage[1].toFixed(1)}`);
  expect(lines[1].label).toBe(`전부 체결 시 평단 ${stage[2].toFixed(1)}`);
  const y = (await page.evaluate((p) => window.__rrDebug.priceToClientY(p), stage[2]))! - (await chartRect(page)).top;
  expect(lines[1].y).toBeCloseTo(y, 0);

  // 5분할 → 2·3·4차 체결 시 + 전부 체결 시
  await page.getByTestId('sizing-splits').selectOption('5');
  await expect.poll(async () => (await rendered(page))?.avgLines.map((l) => l.label.split(' ')[0]) ?? []).toEqual(['2차', '3차', '4차', '전부']);

  // 끄고 켜기 (새로고침해도 유지)
  const toggle = page.getByTestId('sizing-avg-toggle');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => finalAvgY(page)).toBeNull();
  await expect(avgCell).not.toHaveText(''); // 패널 값은 그대로
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId('sizing-avg-toggle')).not.toBeChecked();
  await expect.poll(async () => (await rendered(page)) !== null).toBe(true);
  expect((await rendered(page))!.avgLines).toEqual([]);
  await page.getByTestId('sizing-avg-toggle').check();
  await expect.poll(() => finalAvgY(page)).not.toBeNull();

  await page.getByTestId('sizing-splits').selectOption('1'); // 1회 진입이면 평단 = 진입가라 선을 그리지 않는다
  await expect.poll(() => finalAvgY(page)).toBeNull();
});

test('click the box to select it, Delete clears the calculation; typing Delete in an input does not', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const e = (await scenario(page))!.entry;
  await setLevel(page, 'sl', (e * 0.985).toFixed(1));
  await setLevel(page, 'tp', (e * 1.02).toFixed(1));
  await expect.poll(async () => { const g = await rendered(page); return !!(g?.profit && g?.loss); }).toBe(true);
  const g = (await rendered(page))!;
  const r = await chartRect(page);
  const lines = [g.ySl!, g.yTp!, ...g.presets.map((p) => p.y), ...g.splits.map((p) => p.y), ...g.avgLines.map((p) => p.y)];
  let y = Math.max(0, Math.min(g.profit!.y, g.loss!.y)) + 2;
  while (lines.some((l) => Math.abs(l - y) < 10)) y += 2;

  await page.mouse.click(r.left + g.x1 + 12, r.top + y);
  await expect.poll(() => page.evaluate(() => window.__rrDebug.isBoxSelected())).toBe(true);
  // 박스가 선택된 채로 입력칸에서 Backspace·Delete는 글자만 지운다
  await page.getByTestId('sizing-capital').fill('123');
  await page.getByTestId('sizing-capital').press('Backspace');
  await page.getByTestId('sizing-capital').press('Delete');
  expect(await page.evaluate(() => window.__rrDebug.isBoxSelected())).toBe(true);
  expect(await scenario(page)).not.toBeNull();

  await page.mouse.click(r.left + 30, r.top + r.height / 2); // 바깥 → 선택 해제
  await expect.poll(() => page.evaluate(() => window.__rrDebug.isBoxSelected())).toBe(false);
  await page.keyboard.press('Delete');
  expect(await scenario(page)).not.toBeNull();

  await page.mouse.click(r.left + g.x1 + 12, r.top + y);
  await expect.poll(() => page.evaluate(() => window.__rrDebug.isBoxSelected())).toBe(true);
  await page.keyboard.press('Delete');
  await expect.poll(() => scenario(page)).toBeNull();
  await expect.poll(() => rendered(page)).toBeNull();
});

test('candle wicks are white', async ({ page }) => {
  await open(page, { tf: '15' });
  expect(await page.evaluate(() => window.__rrDebug.wickColors())).toEqual({ up: '#FFFFFF', down: '#FFFFFF' });
});

test('the RR box stays on one line even for a long value', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  await page.getByTestId('rr-input').fill('12.75');
  await page.getByTestId('rr-input').press('Enter');
  await expect(page.getByTestId('rr-input')).toHaveValue('12.75');
  expect((await page.getByTestId('rr-edit').boundingBox())!.height).toBeLessThan(60);
});

test('candle legend: current candle by default, the hovered candle on hover, current again right of the candles', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.mouse.move(2, 2); // 차트 밖
  const now = await page.evaluate(() => ({
    legend: window.__rrDebug.getLegend(), snap: window.__rrDebug.getLiveSnapshot(), n: window.__rrDebug.getCandleCount(),
    closes: window.__rrDebug.getRecentCloses(2),
  }));
  expect(now.legend.index).toBe(now.n - 1);
  expect(now.legend.stats!.time).toBe(now.snap.lastCandle!.time);
  expect(now.legend.stats!.changePct).toBeCloseTo(((now.closes[1] - now.closes[0]) / now.closes[0]) * 100, 6);
  expect(now.legend.text).toMatch(/^시 [\d.]+고 [\d.]+저 [\d.]+종 [\d.]+[+−][\d.]+ \([+−][\d.]+%\)진폭 [\d.]+%$/);

  // 10봉 전 캔들 위
  const r = await chartRect(page);
  const target = await page.evaluate(() => {
    const n = window.__rrDebug.getCandleCount();
    const closes = window.__rrDebug.getRecentCloses(40);
    const t = window.__rrDebug.getLiveSnapshot().lastCandle!.time - 10 * 15 * 60_000;
    return { n, t, x: window.__rrDebug.timeToX(t)!, closes };
  });
  await page.mouse.move(r.left + target.x, r.top + r.height / 2);
  await expect.poll(async () => (await page.evaluate(() => window.__rrDebug.getLegend())).stats!.time).toBe(target.t);
  const hovered = await page.evaluate(() => window.__rrDebug.getLegend());
  expect(hovered.index).toBe(target.n - 11);
  // 이동평균도 그 캔들 기준
  const ma20 = target.closes.slice(40 - 11 - 19, 40 - 10).reduce((a, b) => a + b, 0) / 20;
  const shown = Number((await page.getByTestId('ma-legend').textContent())!.match(/MA20 ([\d.]+)/)![1]);
  expect(shown).toBeCloseTo(ma20, 0);

  // 캔들 오른쪽 빈 곳 → 현재 캔들
  const lastX = await page.evaluate(() => window.__rrDebug.timeToX(window.__rrDebug.getLiveSnapshot().lastCandle!.time)!);
  await page.mouse.move(r.left + lastX + 60, r.top + r.height / 2);
  await expect.poll(async () => (await page.evaluate(() => window.__rrDebug.getLegend())).index).toBe(
    await page.evaluate(() => window.__rrDebug.getCandleCount() - 1),
  );
});
