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
