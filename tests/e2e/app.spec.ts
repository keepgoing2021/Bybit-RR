import { expect, test, type Page } from '@playwright/test';
import type { BoxGeometry } from '../../src/chart/geometry';
import type { Scenario } from '../../src/core/scenario';

// 이 파일의 E2E는 테스트 전용 화면(tests/harness)에서 가짜 시세(DEMO-BTC, 호가 단위 0.1)로 실행한다.
// 배포되는 앱에는 가짜 시세가 없다. Bybit 형식 그대로의 시험은 bybit-mock.spec.ts.
type Debug = {
  getScenario(): Scenario | null;
  getLastCopied(): string | null;
  timeToX(ms: number): number | null;
  isBoxSelected(): boolean;
  wickColors(): { up: string; down: string };
  getTheme(): 'dark' | 'light';
  chartBackground(): string;
  getDrawings(): { drawings: { id: string; kind: string; points: { time: number; price: number }[]; color?: string }[]; selected: string | null; handles: Record<string, { x: number; y: number }[]> };
  getDrawState(): { tool: string | null; placed: number };
  drawLineWidth(): number;
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
  interface Window { __rrDebug: Debug; __rrTest: { disconnect(ms: number): void } }
}

async function open(page: Page, opts: { speed?: number; tf?: string } = {}) {
  await page.goto(`/tests/harness/index.html?speed=${opts.speed ?? 1}`);
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

test('black dark theme by default; the theme button switches to light and back, and is remembered', async ({ page }) => {
  await open(page, { tf: '15' });
  const look = () =>
    page.evaluate(() => ({
      theme: window.__rrDebug.getTheme(),
      attr: document.documentElement.dataset.theme,
      body: getComputedStyle(document.body).backgroundColor,
      chart: window.__rrDebug.chartBackground(),
      wick: window.__rrDebug.wickColors().up,
      rrHead: getComputedStyle(document.querySelector('.rr-edit .rr-head')!).color,
    }));
  await validLong(page);
  expect(await look()).toEqual({ theme: 'dark', attr: 'dark', body: 'rgb(0, 0, 0)', chart: '#000000', wick: '#FFFFFF', rrHead: 'rgb(255, 255, 255)' });
  const toggle = page.getByTestId('theme-toggle');
  await expect(toggle).toContainText('라이트');

  await toggle.click();
  // 라이트: 흰 바탕, 꼬리·'1:'·평단 같은 흰 강조는 거의 검정으로 (원으로 퍼지는 전환 뒤)
  await expect.poll(look).toEqual({ theme: 'light', attr: 'light', body: 'rgb(255, 255, 255)', chart: '#FFFFFF', wick: '#14171C', rrHead: 'rgb(20, 23, 28)' });
  await expect(toggle).toContainText('다크');
  expect(await page.evaluate(() => localStorage.getItem('rrtool.v1.theme'))).toBe('light');

  // 새로고침해도 라이트. 앱 코드보다 먼저(페이지 첫 스크립트) 적용돼 검정 화면이 번쩍이지 않는다:
  // 앱 코드를 막고 열어도 라이트
  await page.route('**/tests/harness/main.ts', (r) => r.abort());
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.unroute('**/tests/harness/main.ts');
  await page.reload();
  await waitLive(page);
  expect((await look()).chart).toBe('#FFFFFF');

  await page.getByTestId('theme-toggle').click();
  await page.reload(); // 누르는 즉시 저장되므로 전환 도중에 새로고침해도 남는다
  await waitLive(page);
  expect((await look()).body).toBe('rgb(0, 0, 0)');
});

test('theme switch spreads as a circle from the button; instant when motion is reduced', async ({ page }) => {
  await open(page, { tf: '15' });
  // 원 애니메이션 호출을 기록
  await page.evaluate(() => {
    const w = window as unknown as { __anims: { frames: unknown; pseudo?: string; duration?: number }[] };
    w.__anims = [];
    const orig = Element.prototype.animate;
    Element.prototype.animate = function (frames, opts) {
      const o = typeof opts === 'object' ? opts : {};
      w.__anims.push({ frames, pseudo: (o as KeyframeAnimationOptions).pseudoElement ?? undefined, duration: Number(o.duration) });
      return orig.call(this, frames, opts);
    };
  });
  const toggle = page.getByTestId('theme-toggle');
  const b = (await toggle.boundingBox())!;
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // 원은 새 화면이 준비된 다음 프레임에 그려진다
  type Rec = { frames: { clipPath: string[] }; pseudo?: string; duration?: number };
  const circleAnim = () =>
    page.evaluate(() => (window as unknown as { __anims: Rec[] }).__anims.find((a) => a.pseudo === '::view-transition-new(root)') ?? null);
  await expect.poll(circleAnim).not.toBeNull();
  const circle = (await circleAnim())!;
  expect(circle.duration).toBe(500);
  const [from, to] = circle.frames.clipPath;
  const m = from.match(/^circle\(0px at ([\d.]+)px ([\d.]+)px\)$/)!;
  expect(Math.abs(Number(m[1]) - (b.x + b.width / 2))).toBeLessThan(1);
  expect(Math.abs(Number(m[2]) - (b.y + b.height / 2))).toBeLessThan(1);
  // 끝 원은 버튼에서 가장 먼 화면 모서리까지 덮는다
  const vp = page.viewportSize()!;
  const far = Math.hypot(Math.max(b.x + b.width / 2, vp.width - b.x - b.width / 2), Math.max(b.y + b.height / 2, vp.height - b.y - b.height / 2));
  expect(Math.abs(Number(to.match(/^circle\(([\d.]+)px/)![1]) - far)).toBeLessThan(1);
  // 동작 줄이기: 원 없이 누르는 즉시
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => ((window as unknown as { __anims: unknown[] }).__anims.length = 0));
  await toggle.click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __anims: unknown[] }).__anims.length)).toBe(0);
});

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
  await page.evaluate(() => window.__rrTest.disconnect(6_000));
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
  await expect(page.locator('[role=dialog]:visible')).toHaveCount(0); // (사용 안내 말풍선은 닫혀 있음)
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
  // 체크가 칸 크기를 바꾸지 않는지: 누른 칸의 폭·높이와 그 줄의 높이 (패널 스크롤바가 생겨 표 폭이 바뀌는 것과는 무관하게)
  const cellBox = async () => page.getByTestId('sizing-row').first().evaluate((row) => {
    const b = row.querySelector('td:nth-child(4) [data-testid=copy]')!.getBoundingClientRect();
    return [Math.round(b.width), Math.round(b.height), Math.round(row.getBoundingClientRect().height)];
  });
  const before = await cellBox();
  await qty.click();
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getLastCopied())).toBe(text);
  // 누른 숫자 자리가 초록 체크로 (아래 알림은 없음), 옆 칸을 덮지 않고 칸 크기도 그대로, 1.2초 뒤 원래대로
  await expect(qty).toHaveClass(/copied/);
  await expect(qty).toHaveAttribute('title', '복사됨');
  const badge = await qty.evaluate((el) => {
    const a = getComputedStyle(el, '::after');
    return { content: a.content, left: a.left, right: a.right };
  });
  expect(badge).toEqual({ content: '"✓"', left: '-3px', right: '-3px' });
  await expect(page.getByTestId('toast')).toBeHidden();
  expect(await cellBox()).toEqual(before);
  await expect(qty).not.toHaveClass(/copied/, { timeout: 3_000 });
  const money = page.getByTestId('sizing-row').first().locator('td:nth-child(3) [data-testid=copy]');
  await money.click();
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getLastCopied())).toBe((await money.textContent())!.replace(/,/g, ''));
  await expect(money).toHaveClass(/copied/);
  await expect(qty).not.toHaveClass(/copied/); // 다른 칸은 그대로
});

test('a slow click on an order-table number still copies: the table is not rebuilt on every price tick', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  await page.getByTestId('sizing-capital').fill('10000');
  await page.getByTestId('sizing-capital').press('Enter');
  const qty = page.getByTestId('sizing-row').first().locator('td:nth-child(4) [data-testid=copy]');
  // 시세가 몇 번 오는 동안(가짜 시세는 0.25초마다) 같은 버튼이 그대로 있다
  await qty.evaluate((el) => el.setAttribute('data-mark', 'same'));
  await page.waitForTimeout(1_000);
  await expect(qty).toHaveAttribute('data-mark', 'same');
  // 0.7초 동안 눌렀다 떼도 복사된다 (누르는 사이 버튼이 바뀌면 클릭이 사라진다)
  const text = (await qty.textContent())!;
  const b = (await qty.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__rrDebug.getLastCopied())).toBe(text);
  await expect(qty).toHaveClass(/copied/);
  // 내용이 바뀌면(운영자산) 표는 새로 그려진다
  await page.getByTestId('sizing-capital').fill('20000');
  await page.getByTestId('sizing-capital').press('Enter');
  await expect(qty).not.toHaveAttribute('data-mark', 'same');
  await expect(qty).not.toHaveText(text);
});

/** 안내의 빛 상자가 대상을 감싸고(화면 안으로 자른 범위), 말풍선이 화면 안에 다 들어오는지 */
export async function tourLayout(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const t = document.querySelector(sel)!.getBoundingClientRect();
    const s = document.querySelector('[data-testid=tour-spot]')!.getBoundingClientRect();
    const p = document.querySelector('[data-testid=tour-tip]')!.getBoundingClientRect();
    const clip = { l: Math.max(0, t.left), t: Math.max(0, t.top), r: Math.min(vw, t.right), b: Math.min(vh, t.bottom) };
    return {
      covers: s.left <= clip.l + 0.5 && s.top <= clip.t + 0.5 && s.right >= clip.r - 0.5 && s.bottom >= clip.b - 0.5,
      tight: s.width - (clip.r - clip.l) <= 14 && s.height - (clip.b - clip.t) <= 14,
      tipInside: p.left >= 0 && p.top >= 0 && p.right <= vw && p.bottom <= vh,
    };
  }, selector);
}

test('first-use tour: 5 spots with skip / back / next, keys work, clicks behind are blocked, shown once, "?" reopens', async ({ page }) => {
  await page.goto('/tests/harness/index.html?tour=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const tour = page.getByTestId('tour');
  await expect(tour).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('feed-status')).toHaveAttribute('data-state', 'live');
  const count = page.getByTestId('tour-count');
  const title = page.getByTestId('tour-title');
  const next = page.getByTestId('tour-next');
  const steps: [string, string][] = [
    ['종목 고르기', '.topbar .field:has([data-testid=symbol])'],
    ['LONG 또는 SHORT', '.topbar .sides'],
    ['운영자산과 손실 한도', '[data-testid=sizing-bar]'],
    ['차트에서 고치기', '.chart-wrap'],
    ['주문표 복사', '.panel .scenario'],
  ];
  const check = async (k: number) => {
    await expect(count).toHaveText(`${k + 1} / 5`);
    await expect(title).toHaveText(steps[k][0]);
    await expect.poll(async () => tourLayout(page, steps[k][1]), { timeout: 3_000 }).toEqual({ covers: true, tight: true, tipInside: true });
  };
  await check(0);
  await expect(page.getByTestId('tour-prev')).toBeHidden();
  await expect(next).toHaveText('다음');
  await expect(next).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await check(1);
  await next.click();
  await check(2);
  await page.getByTestId('tour-prev').click();
  await check(1);
  await page.keyboard.press('Enter'); // 다음 버튼에 포커스: 한 번만 넘어간다
  await check(2);
  await page.keyboard.press('ArrowLeft');
  await check(1);
  await page.keyboard.press('ArrowRight');
  // Shift+Tab으로 '이전'에 포커스 → Enter는 그 버튼(이전)으로
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('tour-prev')).toBeFocused();
  await page.keyboard.press('Enter');
  await check(1);
  // Tab은 말풍선 버튼 안에서만 돈다 (건너뛰기 → 이전 → 다음 → 건너뛰기)
  await expect(next).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('tour-skip')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(next).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await check(3);
  await next.click();
  await check(4);
  await expect(next).toHaveText('시작하기');
  // 안내가 떠 있는 동안 뒤의 화면은 눌리지 않는다
  const long = await page.getByTestId('btn-long').boundingBox();
  await page.mouse.click(long!.x + long!.width / 2, long!.y + long!.height / 2);
  await page.waitForTimeout(200);
  expect(await scenario(page)).toBeNull();
  await next.click();
  await expect(tour).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('rrtool.v1.tourDone'))).toBe('1');
  // 다시 들어와도 저절로 뜨지 않는다
  await page.reload();
  await waitLive(page);
  await page.waitForTimeout(400);
  await expect(tour).toBeHidden();
  // '?'로 다시 보기, Esc는 건너뛰기
  await expect(page.getByTestId('tour-open')).toContainText('안내');
  await page.getByTestId('tour-open').click();
  await check(0);
  await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
});

test('clearing a calculation, deleting a drawing or clearing all drawings can be undone for 5 seconds (button or Ctrl+Z)', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page);
  const bar = page.getByTestId('undo-bar');
  // 계산 지우기 → 되돌리기 버튼
  await page.locator('.card').getByText('지우기', { exact: true }).click();
  await expect.poll(() => scenario(page)).toBeNull();
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('undo-text')).toHaveText('계산을 지웠습니다');
  await page.getByTestId('undo-btn').click();
  await expect.poll(async () => (await scenario(page))?.id).toBe(s.id);
  expect((await scenario(page))!.applied).toEqual(s.applied);
  await expect(bar).toBeHidden();
  // 박스를 눌러 선택 → Delete → Ctrl+Z
  const g = (await rendered(page))!;
  const r = await page.evaluate(() => window.__rrDebug.chartClientRect());
  await page.mouse.click(r.left + (g.x1 + g.x2) / 2, r.top + (g.yEntry + g.ySl!) / 2);
  await expect.poll(() => page.evaluate(() => window.__rrDebug.isBoxSelected())).toBe(true);
  await page.keyboard.press('Delete');
  await expect.poll(() => scenario(page)).toBeNull();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await scenario(page))?.id).toBe(s.id);
  // 5초가 지나면 알림이 사라지고 되돌릴 수 없다
  await page.locator('.card').getByText('지우기', { exact: true }).click();
  await expect(bar).toBeVisible();
  await expect(bar).toBeHidden({ timeout: 7_000 });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  expect(await scenario(page)).toBeNull();
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
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator(':scope > summary').click();
  const control = page.getByTestId(`setting-${key}`);
  await control.fill(value);
  await control.press('Enter');
  await control.blur();
}

async function setSlMode(page: Page, mode: string) {
  const details = page.locator('details.settings');
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator(':scope > summary').click();
  await page.getByTestId('setting-slMode').selectOption(mode);
}

test('auto-suggestion settings: one-line summary, only the core items, the chosen method\'s number only, the rest under 고급; changes recalc the open SL', async ({ page }) => {
  await open(page, { tf: '15' });
  const details = page.locator('details.settings');
  const summary = page.getByTestId('settings-summary');
  // 접혀 있어도 지금 적용 중인 값이 보인다
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText('스윙 2봉 · 1:1.5'); // SL 여유는 패널 손절 줄 아래로 옮겨 요약에서 뺐다
  await details.locator(':scope > summary').click();
  const visible = async () =>
    page.locator('details.settings .setting').evaluateAll((rows) =>
      rows.filter((r) => (r as HTMLElement).checkVisibility()).map((r) => (r as HTMLElement).dataset.key),
    );
  expect(await visible()).toEqual(['slMode', 'swingBars', 'defaultRR']);
  await expect(page.getByTestId('setting-slBufferPct')).toHaveCount(0);
  await expect(page.getByTestId('setting-mode-help')).toHaveText('최근 꺾인 저점 (숏은 고점)');
  await page.getByTestId('setting-slMode').selectOption('lowestN');
  expect(await visible()).toEqual(['slMode', 'slLowestBars', 'defaultRR']);
  await expect(summary).toHaveText('최근 20봉 최저 · 1:1.5');
  await page.getByTestId('setting-slMode').selectOption('prevCandle');
  expect(await visible()).toEqual(['slMode', 'defaultRR']);
  await page.getByTestId('setting-slMode').selectOption('swing');
  // 고급은 접혀 있다가 펼치면 보인다
  await expect(page.getByTestId('setting-staleAfterSec')).toBeHidden();
  await page.getByTestId('settings-advanced').locator('summary').click();
  await expect(page.getByTestId('setting-staleAfterSec')).toBeVisible();
  await expect(page.getByTestId('setting-atrPeriod')).toBeVisible();

  // 계산 중에 바꾸면 그 자리에서 자동 SL이 다시 계산된다 (엔트리·시각 그대로)
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s0 = (await scenario(page))!;
  expect(s0.auto.sl.status).toBe('ok');
  // 스윙 좌우 봉 수를 바꾸면 같은 엔트리·시각으로 자동 SL을 다시 고른다
  await setSetting(page, 'swingBars', '3');
  await expect(summary).toHaveText('스윙 3봉 · 1:1.5');
  const s1 = (await scenario(page))!;
  expect([s1.id, s1.entry, s1.priceTime]).toEqual([s0.id, s0.entry, s0.priceTime]);
  await expect(page.getByTestId('sl-rationale')).toContainText('스윙');
  // 다른 설정을 바꿔도 패널의 SL 여유는 그대로 (설정 칸에 없다고 0으로 돌아가지 않는다)
  await page.getByTestId('sl-buffer').fill('0.1');
  await page.getByTestId('sl-buffer').press('Enter');
  await setSetting(page, 'defaultRR', '2');
  await expect(page.getByTestId('sl-buffer')).toHaveValue('0.1');
  // 기본값으로 되돌리면 다시 원래 SL (여유 0 · 스윙 2봉)
  await page.locator('details.settings button.link').click();
  await expect.poll(async () => (await scenario(page))!.applied.sl).toBe(s0.applied.sl);
});

test('SL 여유 sits right under the SL row: chips 0/0.5/1/2% or typed %, recalculates the auto SL, warns inside the hunting zone, keeps a dragged SL', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  let s0 = (await scenario(page))!;
  if (s0.auto.sl.price === null) {
    await page.getByTestId('btn-short').click();
    await expect.poll(async () => (await scenario(page))?.side).toBe('SHORT');
    s0 = (await scenario(page))!;
  }
  const long = s0.side === 'LONG';
  // 손절 줄 바로 다음, 가격 카드 안
  const row = page.getByTestId('sl-buffer-row');
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => el.previousElementSibling?.classList.contains('sl') && !!el.closest('[data-testid=group-levels]'))).toBe(true);
  const chips = page.getByTestId('sl-buffer-chip');
  await expect(chips).toHaveText(['0%', '0.5%', '1%', '2%']);
  const lit = () => chips.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent));
  expect(await lit()).toEqual(['0%']);
  await expect(page.getByTestId('sl-buffer')).toHaveValue('0');
  // 여유 p%: 꼬리 끝에서 바깥으로 p%, 틱(0.1)은 바깥쪽으로
  const wickTicks = Math.round((long ? s0.auto.sl.candle!.low : s0.auto.sl.candle!.high) * 10);
  const slFor = (p: number) => (long ? Math.floor(wickTicks * (1 - p / 100) + 1e-6) : Math.ceil(wickTicks * (1 + p / 100) - 1e-6)) / 10;
  expect(s0.applied.sl).toBe(slFor(0));
  await chips.filter({ hasText: /^1%$/ }).click();
  await expect.poll(async () => (await scenario(page))!.applied.sl).toBe(slFor(1));
  expect(await lit()).toEqual(['1%']);
  await expect(page.getByTestId('sl-rationale')).toContainText('여유 1%');
  const s1 = (await scenario(page))!;
  expect([s1.id, s1.entry, s1.priceTime, s1.source.sl]).toEqual([s0.id, s0.entry, s0.priceTime, 'auto']);
  // 직접 적기 (칩에 없는 값이면 칩은 꺼짐)
  await page.getByTestId('sl-buffer').fill('0.25');
  await page.getByTestId('sl-buffer').press('Enter');
  await expect.poll(async () => (await scenario(page))!.applied.sl).toBe(slFor(0.25));
  expect(await lit()).toEqual([]);
  // 잘못 적으면 알려 주고 그대로
  await page.getByTestId('sl-buffer').fill('abc');
  await page.getByTestId('sl-buffer').press('Enter');
  await expect(page.getByTestId('toast')).toContainText('SL 여유는');
  await expect(page.getByTestId('sl-buffer')).toHaveValue('0.25');
  // 2%면 SL이 헌팅존(꼬리 끝 2~10%) 안 → 경고
  await chips.filter({ hasText: /^2%$/ }).click();
  await expect.poll(async () => (await scenario(page))!.applied.sl).toBe(slFor(2));
  await expect(page.getByTestId('sl-buffer-note')).toHaveText('💀 SL이 헌팅존 안');
  await chips.filter({ hasText: /^0\.5%$/ }).click();
  await expect(page.getByTestId('sl-buffer-note')).toHaveText('');
  // 새로고침해도 남는다
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId('sl-buffer')).toHaveValue('0.5');
  // 직접 옮긴 SL은 여유를 바꿔도 그대로 (안내 표시)
  const s2 = (await scenario(page))!;
  const moved = Number((s2.applied.sl! + (long ? -15 : 15)).toFixed(1));
  await setLevel(page, 'sl', moved.toFixed(1));
  await expect(page.getByTestId('sl-buffer-note')).toHaveText('직접 옮긴 SL은 그대로');
  await chips.filter({ hasText: /^1%$/ }).click();
  await page.waitForTimeout(300);
  expect((await scenario(page))!.applied.sl).toBe(moved);
  expect((await scenario(page))!.auto.sl.price).toBe(slFor(1)); // 자동값은 새 여유로
});

test('SL timeframe can be picked in every SL mode: default = chart, picking another recalculates the open SL', async ({ page }) => {
  await open(page, { tf: '15' });
  const sltf = page.getByTestId('sltf');
  await expect(sltf).toBeEnabled();
  await expect(sltf).toHaveValue('15');
  await expect(sltf.locator('option:checked')).toHaveText('15분봉 (차트)');
  // 기본은 차트를 따라간다
  await page.getByTestId('tf').selectOption('240');
  await waitLive(page);
  await expect(sltf).toHaveValue('240');
  await page.getByTestId('tf').selectOption('15');
  await waitLive(page);

  await page.getByTestId('btn-long').click(); // 자동 SL 그대로 (직접 옮기지 않음)
  await expect.poll(() => scenario(page)).not.toBeNull();
  const s0 = (await scenario(page))!;
  expect(s0.auto.sl.timeframe).toBe('15');
  expect(s0.source.sl).toBe('auto');
  // 15분봉 차트에서 SL 기준을 1시간봉으로: 다시 누르지 않아도 같은 엔트리·같은 시각으로 SL을 다시 계산
  await sltf.selectOption('60');
  await expect.poll(async () => (await scenario(page))?.auto.sl.timeframe).toBe('60');
  const s1 = (await scenario(page))!;
  expect([s1.id, s1.entry, s1.priceTime]).toEqual([s0.id, s0.entry, s0.priceTime]);
  if (s1.auto.sl.status === 'ok') {
    expect(s1.auto.sl.candle!.time % 3_600_000).toBe(0); // 1시간봉 캔들
    expect(s1.applied.sl).toBe(s1.auto.sl.price);
    expect(s1.auto.sl.price!).toBeLessThan(s1.entry);
    await expect(page.getByTestId('sl-rationale')).toContainText('1시간봉 최근 확정 스윙 저점');
    await expect.poll(() => page.evaluate(() => window.__rrDebug.getHighlight()?.label ?? null)).toBe('SL 기준 1시간봉 스윙 저점');
  } else {
    await expect(page.getByTestId('sl-rationale')).toContainText('유효한 자동 SL 없음');
  }

  // 직접 옮긴 SL은 SL 기준을 바꿔도 그대로 (알림)
  await setLevel(page, 'sl', (s1.entry - 7).toFixed(1));
  await sltf.selectOption('240');
  await expect.poll(async () => (await scenario(page))?.auto.sl.timeframe).toBe('240');
  await expect(page.getByTestId('toast')).toContainText('SL을 직접 바꿔 둔 상태라 그대로');
  expect((await scenario(page))!.applied.sl).toBe(Number((s1.entry - 7).toFixed(1)));

  // 고른 SL 기준은 차트를 바꿔도·새로고침해도 유지, 차트와 같은 값을 고르면 다시 차트를 따라간다
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId('sltf')).toHaveValue('240');
  await page.getByTestId('tf').selectOption('5');
  await waitLive(page);
  await expect(page.getByTestId('sltf')).toHaveValue('240');
  await page.getByTestId('sltf').selectOption('5');
  await page.getByTestId('tf').selectOption('15');
  await waitLive(page);
  await expect(page.getByTestId('sltf')).toHaveValue('15');
});

test('an older save (SL 기준 auto-set to 4h for the previous-candle mode only) keeps the swing SL on the chart timeframe', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.evaluate(() =>
    localStorage.setItem('rrtool.v1.state', JSON.stringify({ version: 1, scenario: null, ui: { provider: 'bybit', symbol: 'DEMO-BTC', timeframe: '15', slTf: '240' } })),
  );
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId('sltf')).toHaveValue('15');
  await page.getByTestId('btn-long').click();
  await expect.poll(async () => (await scenario(page))?.auto.sl.timeframe).toBe('15');
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
  // 호가 단위(0.1)로 반올림: 손절폭이 홀수 틱이면 1.5배가 정확히 반 틱(.x5)이라 toFixed와 결과가 다를 수 있다
  const ticks = (p: number) => Math.round(p * 10);
  expect(Math.round(s.applied.tp! * 10)).toBe(Math.round(ticks(s.entry) + 1.5 * (ticks(s.entry) - ticks(s.applied.sl!))));
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
  let s = (await scenario(page))!;
  // 가짜 시세는 시각에 따라 움직여서, 지금가가 직전 4시간봉 저가 아래면 LONG의 SL이 무효다.
  // 그때는 고가가 반드시 지금가 위이므로 SHORT로 확인한다 (어느 한쪽은 늘 유효)
  if (s.auto.sl.price === null) {
    await page.getByTestId('btn-short').click();
    await expect.poll(async () => (await scenario(page))?.side).toBe('SHORT');
    s = (await scenario(page))!;
  }
  expect(s.auto.sl.price).not.toBeNull();
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

test('panel RR chips 1:1–1:3 move TP like the chart chips; the current RR is lit; locked when SL is on the wrong side', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page); // SL = 진입 − 10, TP = 진입 + 30 → 1:3
  const chips = page.getByTestId('rr-chip');
  await expect(chips).toHaveText(['1:1', '1:1.5', '1:2', '1:2.5', '1:3']);
  const lit = async () => (await chips.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent)));
  expect(await lit()).toEqual(['1:3']);
  await expect(chips.nth(4)).toHaveClass(/active/);
  // 1:1.5 → TP = 진입 + 15, 진입·SL 그대로, 그 칩만 켜짐
  await chips.nth(1).click();
  await expect.poll(async () => (await scenario(page))!.applied.tp).toBe(Number((s.entry + 15).toFixed(1)));
  const s2 = (await scenario(page))!;
  expect(s2.entry).toBe(s.entry);
  expect(s2.applied.sl).toBe(s.applied.sl);
  await expect(page.getByTestId('rr-input')).toHaveValue('1.5');
  expect(await lit()).toEqual(['1:1.5']);
  // 칩에 없는 손익비면 아무것도 안 켜짐
  await setLevel(page, 'tp', (s.entry + 17).toFixed(1));
  await expect(page.getByTestId('rr-input')).toHaveValue('1.7');
  expect(await lit()).toEqual([]);
  // 한 줄에 다섯 개
  const tops = await chips.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(tops).toBe(1);
  // SL이 진입가 위(롱인데)면 TP를 손익비로 정할 수 없어 칩이 잠긴다
  await setLevel(page, 'sl', (s.entry + 5).toFixed(1));
  for (let i = 0; i < 5; i++) await expect(chips.nth(i)).toBeDisabled();
  await setLevel(page, 'sl', (s.entry - 10).toFixed(1));
  await expect(chips.first()).toBeEnabled();
});

test('the panel is grouped into cards (prices / RR / order table / reasons); SL in red and TP in green', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  // 큰 금액(총 포지션 7만대)에서도 요약 숫자가 한 줄로 들어가는지 함께 본다
  await page.getByTestId('sizing-capital').fill('100000');
  await page.getByTestId('sizing-capital').press('Enter');
  await expect(page.getByTestId('sizing-row')).toHaveCount(3);
  const look = () =>
    page.evaluate(() => {
      const panelBg = getComputedStyle(document.querySelector('.panel')!).backgroundColor;
      const groups = ['group-levels', 'group-rr', 'sizing', 'group-why'].map((id) => {
        const el = document.querySelector(`[data-testid=${id}]`)!;
        const cs = getComputedStyle(el);
        return { id, border: cs.borderTopStyle, card: cs.backgroundColor !== panelBg && cs.backgroundColor !== 'rgba(0, 0, 0, 0)', radius: cs.borderTopLeftRadius };
      });
      const color = (sel: string) => getComputedStyle(document.querySelector(sel)!).color;
      return {
        groups,
        inLevels: !!document.querySelector('[data-testid=group-levels] [data-testid=sl-input]'),
        inRr: !!document.querySelector('[data-testid=group-rr] [data-testid=rr-input]') && !!document.querySelector('[data-testid=group-rr] [data-testid=rr-chips]'),
        slName: color('.price-row.sl .price-name'),
        slInput: color('[data-testid=sl-input]'),
        tpName: color('.price-row.tp .price-name'),
        tpInput: color('[data-testid=tp-input]'),
        entryInput: color('[data-testid=entry-input]'),
        // 주문표 요약의 '모두 체결되면' 줄은 카드가 아니라 위 선 하나만
        foldRow: (() => {
          const cs = getComputedStyle(document.querySelector('.sizing .metrics dt.group')!);
          return [cs.borderLeftStyle, cs.borderTopStyle, cs.backgroundColor];
        })(),
        // 요약 숫자들은 한 줄씩 (카드 여백이 생겨도 줄바꿈되지 않게)
        wrappedSummary: [...document.querySelectorAll('[data-testid=sizing-summary] dd:not(.group)')]
          .filter((el) => (el as HTMLElement).offsetParent && el.textContent)
          .filter((el) => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1;
          })
          .map((el) => el.textContent),
        hintLines: (() => {
          const r = document.createRange();
          r.selectNodeContents(document.querySelector('[data-testid=rr-hint]')!);
          return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
        })(),
      };
    });
  const d = await look();
  for (const g of d.groups) expect(g, g.id).toEqual({ id: g.id, border: 'solid', card: true, radius: '8px' });
  expect(d.inLevels && d.inRr).toBe(true);
  expect([d.slName, d.slInput]).toEqual(['rgb(240, 97, 109)', 'rgb(240, 97, 109)']);
  expect([d.tpName, d.tpInput]).toEqual(['rgb(46, 189, 133)', 'rgb(46, 189, 133)']);
  expect(d.entryInput).toBe('rgb(230, 232, 235)'); // 진입은 기본 글자색
  expect(d.foldRow).toEqual(['none', 'solid', 'rgba(0, 0, 0, 0)']);
  expect(d.wrappedSummary).toEqual([]);
  expect(d.hintLines).toBe(1); // 안내 문구는 한 줄
  // 라이트에서도 카드가 패널과 구분된다
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => (await look()).groups.every((g) => g.card)).toBe(true);
  expect((await look()).slInput).toBe('rgb(224, 62, 77)');
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

  await typeIn(page, 'sizing-splits', '5');
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

test('fee at stop: amount and share of the loss, colored by zone, with a small meter (end = 50%)', async ({ page }) => {
  await open(page, { tf: '15' });
  const s = await validLong(page); // SL = 엔트리 − 10
  await page.getByTestId('sizing-capital').fill('10,000');
  await page.getByTestId('sizing-capital').press('Enter');
  const num = (t: string) => Number(t.replace(/,/g, ''));
  const read = async () => {
    const total = num((await page.getByTestId('sizing-total').textContent())!.match(/([\d,.]+) USDT/)![1]);
    const loss = num((await page.getByTestId('sizing-loss').textContent())!.match(/−([\d,.]+)/)![1]);
    const t = (await page.getByTestId('sizing-fee').textContent())!;
    const m = t.match(/^([\d,.]+) USDT$/)!;
    expect(m, t).not.toBeNull();
    const sh = (await page.getByTestId('sizing-fee-share').textContent())!.match(/^손실의 (\d+)%$/)!;
    return { total, loss, fee: num(m[1]), share: Number(sh[1]) };
  };
  const f = await read();
  // 수수료 = 전부 체결 금액 × (0.02% + 0.055%), 몫 = 수수료 ÷ 손절 손실
  expect(Math.abs(f.fee - f.total * 0.00075)).toBeLessThan(0.011);
  expect(Math.abs(f.share - (f.fee / f.loss) * 100)).toBeLessThan(0.6);
  const zoneOf = (v: number) => (v < 10 ? 'low' : v < 20 ? 'mid' : 'high');
  await expect(page.getByTestId('sizing-fee')).toHaveAttribute('data-zone', zoneOf((f.total * 0.00075 / f.loss) * 100));
  await expect(page.getByTestId('sizing-fee-share')).toHaveAttribute('data-zone', zoneOf((f.total * 0.00075 / f.loss) * 100));
  // 한 줄씩: 금액 칸과 '손실의 %'가 줄바꿈되지 않는다
  for (const id of ['sizing-fee', 'sizing-fee-share']) {
    const lines = await page.getByTestId(id).evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
    });
    expect(lines).toBe(1);
  }
  const fillPct = async () => page.getByTestId('sizing-fee-fill').evaluate((el) => {
    const p = el.parentElement!.getBoundingClientRect();
    return (el.getBoundingClientRect().width / p.width) * 100;
  });
  expect(Math.abs((await fillPct()) - Math.min(100, (f.total * 0.00075 / f.loss) * 100 / 50 * 100))).toBeLessThan(1.5);
  // 손절을 넓히면 포지션이 작아져 몫이 줄고 색이 바뀐다
  await setLevel(page, 'sl', (s.entry - 400).toFixed(1));
  await expect.poll(async () => (await read()).share).toBeLessThan(f.share);
  const g = await read();
  await expect(page.getByTestId('sizing-fee')).toHaveAttribute('data-zone', zoneOf((g.total * 0.00075 / g.loss) * 100));
  expect(await fillPct()).toBeLessThan(await (async () => Math.min(100, f.share * 2) + 2)());
  const colors = await page.getByTestId('sizing-fee').evaluate((el) => getComputedStyle(el).color);
  expect(colors).not.toBe('');
});

test('fee tier buttons (일반 · VIP1–5) switch the Bybit fee used for the fee at stop, and are remembered', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  await page.getByTestId('sizing-capital').fill('10,000');
  await page.getByTestId('sizing-capital').press('Enter');
  const tiers = page.getByTestId('fee-tier');
  await expect(tiers).toHaveText(['일반', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5']);
  const lit = () => tiers.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent));
  expect(await lit()).toEqual(['일반']);
  await expect(page.getByTestId('fee-rates')).toHaveText('지정가 0.02% · 시장가 0.055%');
  const num = (t: string) => Number(t.replace(/,/g, ''));
  const read = async () => ({
    total: num((await page.getByTestId('sizing-total').textContent())!.match(/([\d,.]+) USDT/)![1]),
    fee: num((await page.getByTestId('sizing-fee').textContent())!.match(/^([\d,.]+) USDT$/)![1]),
    share: Number((await page.getByTestId('sizing-fee-share').textContent())!.match(/(\d+)%/)![1]),
  });
  const base = await read();
  expect(Math.abs(base.fee - base.total * 0.00075)).toBeLessThan(0.011);
  // Bybit 파생상품 표: (메이커 + 테이커) %
  const table: [string, number, string][] = [
    ['VIP1', 0.058, '지정가 0.018% · 시장가 0.04%'],
    ['VIP2', 0.0535, '지정가 0.016% · 시장가 0.0375%'],
    ['VIP3', 0.049, '지정가 0.014% · 시장가 0.035%'],
    ['VIP4', 0.044, '지정가 0.012% · 시장가 0.032%'],
    ['VIP5', 0.042, '지정가 0.01% · 시장가 0.032%'],
  ];
  let prev = base.fee;
  for (const [name, pct, rates] of table) {
    await tiers.filter({ hasText: name }).click();
    await expect(page.getByTestId('fee-rates')).toHaveText(rates);
    expect(await lit()).toEqual([name]);
    const r = await read();
    expect(Math.abs(r.fee - (r.total * pct) / 100)).toBeLessThan(0.011);
    expect(r.fee).toBeLessThan(prev); // 등급이 오를수록 수수료가 준다
    expect(r.total).toBe(base.total); // 포지션 크기·손실 계산은 그대로
    prev = r.fee;
    await expect(page.locator('.metrics dt', { hasText: '손절 시 수수료' })).toHaveAttribute('title', new RegExp(`Bybit ${name}`));
  }
  // 버튼 여섯 개는 한 줄
  expect(await tiers.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size)).toBe(1);
  // 새로고침해도 VIP5
  await page.reload();
  await waitLive(page);
  expect(await page.evaluate(() => localStorage.getItem('rrtool.v1.feetier'))).toBe('vip5');
  await page.getByTestId('btn-long').click();
  await expect(page.getByTestId('sizing-row').first()).toBeVisible();
  expect(await lit()).toEqual(['VIP5']);
  await expect(page.getByTestId('fee-rates')).toHaveText('지정가 0.01% · 시장가 0.032%');
  await tiers.filter({ hasText: '일반' }).click();
  expect(await lit()).toEqual(['일반']);
});

test('stop-hunting zone: 2–10% beyond the SL wick, as wide as the RR box, with a skull label inside; warns when SL sits inside', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  let s = (await scenario(page))!;
  if (s.auto.sl.price === null) {
    await page.getByTestId('btn-short').click();
    await expect.poll(async () => (await scenario(page))?.side).toBe('SHORT');
    s = (await scenario(page))!;
  }
  const c = s.auto.sl.candle!;
  const long = s.side === 'LONG';
  const wick = long ? c.low : c.high;
  const near = wick * (long ? 0.98 : 1.02);
  const far = wick * (long ? 0.9 : 1.1);
  const r = await chartRect(page);
  const hunt = async () => (await rendered(page))!.hunt!;
  const yOf = async (p: number) => (await page.evaluate((v) => window.__rrDebug.priceToClientY(v), p))! - r.top;
  await expect.poll(async () => (await rendered(page))?.hunt ?? null).not.toBeNull();
  let h = await hunt();
  expect(Math.abs(h.yNear - (await yOf(near)))).toBeLessThan(1);
  expect(Math.abs(h.yFar - (await yOf(far)))).toBeLessThan(1);
  // 꼬리 바깥쪽으로: LONG은 아래(좌표가 커짐), SHORT는 위
  expect(long ? h.yFar > h.yNear : h.yFar < h.yNear).toBe(true);
  // 가로는 손익비 박스와 같은 폭 (차트 끝까지 넓게 그리지 않는다)
  const box0 = (await rendered(page))!;
  expect([h.x, h.x2]).toEqual([box0.x1, box0.x2]);
  expect(h.label).toBe('스탑헌팅존 2~10%');
  expect(h.slInside).toBe(false);
  // 그린 방식: 보이는 띠가 이름표(22px)보다 두꺼우면 빗금 띠, 아니면 화면 끝 칩
  const paneH = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[data-testid=chart] canvas')].map((e) => e.getBoundingClientRect());
    return Math.max(...c.filter((b) => b.left < 50).map((b) => b.height));
  });
  const visible = (g: typeof h) => Math.min(paneH, Math.max(g.yNear, g.yFar)) - Math.max(0, Math.min(g.yNear, g.yFar));
  expect(h.drawn).toBe(visible(h) >= 22 ? 'band' : 'edge');
  // 해골 이름표는 목표·손절·손익비 이름표와 겹치지 않는다
  // (화면 끝 칩은 자리가 없으면 생략될 수 있다. 띠가 보이면 이름표는 꼭 있다)
  const noOverlap = (g: typeof h) =>
    !g.chip || (g.avoided ?? []).every((a) => !(g.chip!.x < a.x + a.w && a.x < g.chip!.x + g.chip!.w && g.chip!.y < a.y + a.h && a.y < g.chip!.y + g.chip!.h));
  if (h.drawn === 'band') expect(h.chip).toBeTruthy();
  expect(noOverlap(h)).toBe(true);
  // 해골 이름표는 늘 구간 안: 가로는 박스 폭 안, 띠가 보이면 세로도 띠 안
  const inside = (g: typeof h) => {
    const c = g.chip;
    if (!c) return g.drawn !== 'band';
    const top = Math.max(0, Math.min(g.yNear, g.yFar));
    const bottom = Math.min(paneH, Math.max(g.yNear, g.yFar));
    return c.x >= g.x && c.x + c.w <= g.x2 && (g.drawn !== 'band' || (c.y >= top - 0.5 && c.y + c.h <= bottom + 0.5));
  };
  expect(inside(h)).toBe(true);
  // 가격축을 끌어 넓게 보면 띠가 화면에 들어오고 빗금 띠로 그린다
  for (let k = 0; k < 6 && visible(await hunt()) < 60; k++) {
    await page.mouse.move(r.left + r.width - 30, r.top + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.left + r.width - 30, r.top + r.height / 2 + 160, { steps: 6 });
    await page.mouse.up();
  }
  h = await hunt();
  expect(visible(h)).toBeGreaterThanOrEqual(60);
  expect(h.drawn).toBe('band');
  expect(h.chip).toBeTruthy();
  expect(noOverlap(h)).toBe(true);
  expect(inside(h)).toBe(true);
  // 빗금은 잘 보이는 보라: 구간 안에서 이름표를 피한 곳의 평균 색이 보라 쪽. 박스 밖(오른쪽)은 칠하지 않는다
  const g = (await rendered(page))!;
  const vTop = Math.max(0, Math.min(h.yNear, h.yFar));
  const vBottom = Math.min(paneH, Math.max(h.yNear, h.yFar));
  const chipMid = h.chip ? h.chip.y + h.chip.h / 2 : vTop;
  // 이름표가 있는 쪽의 반대편 절반 가운데
  const yMid = chipMid < (vTop + vBottom) / 2 ? vTop + (vBottom - vTop) * 0.75 : vTop + (vBottom - vTop) * 0.25;
  const [rx1, rx2] = [g.x1 + 4, g.x2 - 4];
  const rgb = await page.evaluate(({ x1, x2, y }) => {
    const cv = [...document.querySelectorAll('[data-testid=chart] canvas')] as HTMLCanvasElement[];
    const sum = [0, 0, 0];
    let n = 0;
    for (const c of cv) {
      const b = c.getBoundingClientRect();
      if (b.left >= 50) continue;
      const k = c.width / b.width;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const d = ctx.getImageData(Math.round(x1 * k), Math.round((y - 10) * k), Math.max(1, Math.round((x2 - x1) * k)), Math.round(20 * k)).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; n++;
      }
    }
    return sum.map((v) => (n ? v / n : 0));
  }, { x1: rx1, x2: rx2, y: yMid });
  expect(rgb[2]).toBeGreaterThan(rgb[1] + 15); // 파랑 > 초록
  expect(rgb[0]).toBeGreaterThan(rgb[1]); // 빨강 > 초록 → 보라
  // 박스 오른쪽(구간 밖)은 칠하지 않음
  const paneW = await page.evaluate(() => Math.max(...[...document.querySelectorAll('[data-testid=chart] canvas')].map((e) => e.getBoundingClientRect()).filter((b) => b.left < 50).map((b) => b.width)));
  if (paneW - g.x2 > 30) {
    const out = await page.evaluate(({ x1, x2, y }) => {
      const cv = [...document.querySelectorAll('[data-testid=chart] canvas')] as HTMLCanvasElement[];
      let blue = 0;
      let n = 0;
      for (const c of cv) {
        const b = c.getBoundingClientRect();
        if (b.left >= 50) continue;
        const k = c.width / b.width;
        const d = c.getContext('2d')!.getImageData(Math.round(x1 * k), Math.round((y - 10) * k), Math.max(1, Math.round((x2 - x1) * k)), Math.round(20 * k)).data;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { blue += d[i + 2] - d[i + 1]; n++; }
      }
      return n ? blue / n : 0;
    }, { x1: g.x2 + 6, x2: Math.min(paneW - 6, g.x2 + 26), y: yMid });
    expect(out).toBeLessThan(8);
  }
  // SL 여유를 5%(구간 안)로 하면 이름표가 경고로, 1%면 다시 보통. 자동 SL일 때 구간은 꼬리 기준이라 그대로
  await page.getByTestId('sl-buffer').fill('5');
  await page.getByTestId('sl-buffer').press('Enter');
  await expect.poll(async () => (await hunt()).slInside).toBe(true);
  expect((await hunt()).label).toBe('스탑헌팅존 · SL이 안에 있음');
  await page.getByTestId('sl-buffer').fill('1');
  await page.getByTestId('sl-buffer').press('Enter');
  await expect.poll(async () => (await hunt()).slInside).toBe(false);
  await expect.poll(async () => Math.abs((await hunt()).yNear - (await yOf(near)))).toBeLessThan(1);
  // SL을 직접 옮기면 구간도 같은 비율로 따라간다: 옮긴 꼬리 = 옮긴 SL ÷ (1 ∓ 여유 1%)
  const followed = async (sl: number) => {
    const tip = long ? sl / 0.99 : sl / 1.01;
    const g2 = await hunt();
    return Math.max(Math.abs(g2.yNear - (await yOf(tip * (long ? 0.98 : 1.02)))), Math.abs(g2.yFar - (await yOf(tip * (long ? 0.9 : 1.1)))));
  };
  const autoSl = (await scenario(page))!.applied.sl!;
  // 차트에서 SL 선을 끌면 (자동 SL 자리에서 25px)
  const gd = (await rendered(page))!;
  await page.mouse.move(r.left + (gd.x1 + gd.x2) / 2, r.top + gd.ySl!);
  await page.mouse.down();
  await page.mouse.move(r.left + (gd.x1 + gd.x2) / 2, r.top + gd.ySl! + (long ? 25 : -25), { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await scenario(page))!.source.sl).toBe('manual');
  const dragged = (await scenario(page))!.applied.sl!;
  expect(dragged).not.toBe(autoSl);
  await expect.poll(() => followed(dragged)).toBeLessThan(1);
  expect((await hunt()).slInside).toBe(false); // 같은 여유(1%)라 SL은 여전히 구간 밖
  // 가격칸에 적어 옮겨도 같다
  const moved = Number((autoSl * (long ? 0.97 : 1.03)).toFixed(1));
  await setLevel(page, 'sl', moved.toFixed(1));
  await expect.poll(async () => (await scenario(page))!.applied.sl).toBe(moved);
  await expect.poll(() => followed(moved)).toBeLessThan(1);
  // 자동값으로 되돌리면 다시 꼬리 기준
  await page.getByTestId('btn-restore').click();
  await expect.poll(async () => Math.abs((await hunt()).yNear - (await yOf(near)))).toBeLessThan(1);
});

test('RR and the profit roll in when they change, but not on every price tick or while dragging', async ({ page }) => {
  await open(page, { tf: '15', speed: 4 });
  await page.getByTestId('btn-long').click();
  await expect.poll(() => scenario(page)).not.toBeNull();
  await page.getByTestId('sizing-capital').fill('10,000');
  await page.getByTestId('sizing-capital').press('Enter');
  await expect(page.getByTestId('sizing-row')).toHaveCount(3);
  const cls = () => page.evaluate(() => ({
    rr: [...document.querySelector('[data-testid=rr-edit]')!.classList].filter((c) => c.startsWith('roll')).join(),
    sum: [...document.querySelector('[data-testid=sizing-rr]')!.classList].filter((c) => c.startsWith('roll')).join(),
    profit: [...document.querySelector('[data-testid=sizing-profit]')!.classList].filter((c) => c.startsWith('roll')).join(),
  }));
  const before = await cls();
  // 시세만 흐를 때는 그대로
  await page.waitForTimeout(1500);
  expect(await cls()).toEqual(before);
  // 칩으로 RR을 바꾸면 세 곳 모두 다시 굴러간다 (roll-a ↔ roll-b).
  // 패널 칩을 쓴다: 차트 칩은 손절폭이 좁으면(가짜 시세가 그런 시각이면) 겹쳐서 숨겨진다
  await page.locator('[data-testid=rr-chip][data-rr="2.5"]').click();
  await expect(page.getByTestId('rr-input')).toHaveValue('2.5');
  const r = await chartRect(page);
  const after = await cls();
  for (const k of ['rr', 'sum', 'profit'] as const) {
    expect(after[k]).toMatch(/^roll-[ab]$/);
    expect(after[k]).not.toBe(before[k]);
  }
  // 끄는 동안에는 굴리지 않는다
  const g2 = (await rendered(page))!;
  await page.mouse.move(r.left + (g2.x1 + g2.x2) / 2, r.top + g2.ySl!);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(r.left + (g2.x1 + g2.x2) / 2, r.top + g2.ySl! + i * 6);
  expect(await cls()).toEqual(after);
  await page.mouse.up();
  // 손을 떼면 한 번 굴러간다
  await expect.poll(async () => (await cls()).rr).not.toBe(after.rr);
  // 숫자를 줄여서 보여주는 애니메이션은 움직임 줄이기 설정에서 꺼진다
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByTestId('rr-edit').evaluate((el) => getComputedStyle(el.querySelector('input')!).animationName)).toBe('none');
});

/** 상단 바 입력칸에 적고 Enter */
async function typeIn(page: Page, testid: string, text: string) {
  const el = page.getByTestId(testid);
  await el.fill(text);
  await el.press('Enter');
}

test('split count and weights are typed: count 1–10, weights as a ratio (count follows) or the two examples', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page); // SL = 엔트리 − 10
  await typeIn(page, 'sizing-capital', '10000');
  const splits = page.getByTestId('sizing-splits');
  const weights = page.getByTestId('sizing-weights');
  const linear = page.getByTestId('sizing-weights-linear');
  const equal = page.getByTestId('sizing-weights-equal');
  const rows = page.getByTestId('sizing-row');
  const toast = page.getByTestId('toast');
  const shares = async () => (await rows.locator('td:nth-child(1) span').allTextContents()).map((t) => Number(t.replace('%', '')));
  const money = async () => (await rows.locator('td:nth-child(3)').allTextContents()).map((t) => Number(t.replace(/,/g, '')));
  const lossAtSl = async () =>
    Number((await page.getByTestId('sizing-loss').textContent())!.match(/−([\d,.]+)/)![1].replace(/,/g, ''));

  // 길게 펼쳐지는 목록 없이 적는 칸 두 개
  await expect(page.locator('.sizing-bar select, .sizing-bar datalist')).toHaveCount(0);
  expect(await splits.getAttribute('type')).toBeNull(); // 숫자 화살표 없는 그냥 글 칸
  for (const box of [splits, weights]) expect(await box.getAttribute('autocomplete')).toBe('off');
  await expect(splits).toHaveValue('3');
  await expect(weights).toHaveValue('1:2:3');
  await expect(linear).toHaveClass(/active/);
  await expect(equal).not.toHaveClass(/active/);

  // 분할 수를 적으면 점점 크게가 그 수에 맞게 1:2:…:N
  await typeIn(page, 'sizing-splits', '4');
  await expect(rows).toHaveCount(4);
  await expect(weights).toHaveValue('1:2:3:4');
  expect(await shares()).toEqual([10, 20, 30, 40]);
  await typeIn(page, 'sizing-splits', '10');
  await expect(rows).toHaveCount(10);
  await expect(weights).toHaveValue('1:2:3:4:5:6:7:8:9:10');
  expect(await lossAtSl()).toBeLessThanOrEqual(100);
  await expect.poll(async () => (await rendered(page))?.splits.length ?? 0).toBe(9);
  for (const bad of ['0', '11', '2.5', 'ab', '']) {
    await typeIn(page, 'sizing-splits', bad);
    await expect(toast).toContainText('분할 수는 1~10');
    await expect(splits).toHaveValue('10');
    await expect(rows).toHaveCount(10);
  }

  // 비율을 적으면 칸 수가 분할 수
  await typeIn(page, 'sizing-weights', '1:1:2');
  await expect.poll(shares).toEqual([25, 25, 50]);
  await expect(splits).toHaveValue('3');
  await expect(linear).not.toHaveClass(/active/);
  await expect(equal).not.toHaveClass(/active/);
  const m = await money();
  expect(m[0] / m[2]).toBeCloseTo(0.5, 2);
  expect(await lossAtSl()).toBeLessThanOrEqual(100);
  expect(await lossAtSl()).toBeGreaterThan(99);
  await typeIn(page, 'sizing-weights', '10/20/30/40/0.5');
  await expect(rows).toHaveCount(5);
  await expect(splits).toHaveValue('5');
  await expect(weights).toHaveValue('10:20:30:40:0.5');
  await typeIn(page, 'sizing-weights', '20/30/50');
  await expect(rows).toHaveCount(3);
  await expect(weights).toHaveValue('20:30:50');
  expect(await shares()).toEqual([20, 30, 50]);
  await expect.poll(async () => (await rendered(page))?.splits.map((x) => x.label) ?? []).toEqual(['2차 30%', '3차 50%']);

  // 잘못 적으면 알려주고 그대로
  for (const bad of ['1:0:2', 'a:b', '', Array(11).fill(1).join(':')]) {
    await typeIn(page, 'sizing-weights', bad);
    await expect(toast).toContainText('비중은 1:1:2나 20/30/50처럼');
    await expect(weights).toHaveValue('20:30:50');
    expect(await shares()).toEqual([20, 30, 50]);
  }

  // 비율을 쓰는 중에 분할 수만 바꾸면 자르거나 마지막 값으로 채운다
  await typeIn(page, 'sizing-splits', '4');
  await expect(weights).toHaveValue('20:30:50:50');
  await expect(rows).toHaveCount(4);
  await typeIn(page, 'sizing-splits', '2');
  await expect(weights).toHaveValue('20:30');
  expect(await shares()).toEqual([40, 60]);

  // 예시 두 가지: 버튼 또는 '균등'·'1:2:…:N'을 직접 적기
  await equal.click();
  await expect(weights).toHaveValue('손실 균등');
  await expect(equal).toHaveClass(/active/);
  await expect(rows).toHaveCount(2);
  await linear.click();
  await expect(weights).toHaveValue('1:2');
  await expect(linear).toHaveClass(/active/);
  await typeIn(page, 'sizing-weights', '균등');
  await expect(weights).toHaveValue('손실 균등');
  await typeIn(page, 'sizing-weights', '1:2:3:4');
  await expect(linear).toHaveClass(/active/);
  await expect(splits).toHaveValue('4');

  // 새로고침해도 남는다
  await typeIn(page, 'sizing-weights', '1:1:2');
  await page.reload();
  await waitLive(page);
  await expect(weights).toHaveValue('1:1:2');
  await expect(splits).toHaveValue('3');
  await expect.poll(shares).toEqual([25, 25, 50]);

  // 1 = 한 번에 진입
  await typeIn(page, 'sizing-splits', '1');
  await expect(rows).toHaveCount(1);
  await expect(weights).toHaveValue('1');
});

test('changing the capital keeps the average-line toggle off', async ({ page }) => {
  await open(page, { tf: '15' });
  await validLong(page);
  await page.getByTestId('sizing-capital').fill('10000');
  await page.getByTestId('sizing-capital').press('Enter');
  await page.getByTestId('sizing-avg-toggle').uncheck();
  await page.getByTestId('sizing-capital').fill('20000');
  await page.getByTestId('sizing-capital').press('Enter');
  await expect(page.getByTestId('sizing-avg-toggle')).not.toBeChecked();
  await expect.poll(async () => (await rendered(page))?.avgLines.length ?? -1).toBe(0);
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
  await typeIn(page, 'sizing-splits', '5');
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
  await typeIn(page, 'sizing-splits', '5');
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

  await typeIn(page, 'sizing-splits', '1'); // 1회 진입이면 평단 = 진입가라 선을 그리지 않는다
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

const drawings = (page: Page) => page.evaluate(() => window.__rrDebug.getDrawings());

/** 차트 안 비율 좌표 → 화면 좌표 */
async function at(page: Page, fx: number, fy: number): Promise<[number, number]> {
  const r = await chartRect(page);
  return [r.left + r.width * fx, r.top + r.height * fy];
}

test('drawing toolbar: › opens it; trend, horizontal, channel and fib draw by clicks; kept per symbol', async ({ page }) => {
  await open(page, { tf: '15' });
  await expect(page.getByTestId('draw-trend')).toBeHidden();
  await page.getByTestId('draw-toggle').click();
  for (const k of ['trend', 'hline', 'channel', 'fib']) await expect(page.getByTestId(`draw-${k}`)).toBeVisible();
  const range0 = await visibleRange(page);

  // 추세선: 2번
  await page.getByTestId('draw-trend').click();
  await expect(page.getByTestId('draw-trend')).toHaveClass(/active/);
  await expect(page.getByTestId('draw-hint')).toContainText('추세선: 시작점');
  const a = await at(page, 0.2, 0.7);
  const b = await at(page, 0.4, 0.4);
  await page.mouse.click(...a);
  await expect(page.getByTestId('draw-hint')).toContainText('끝점');
  await page.mouse.click(...b);
  await expect(page.getByTestId('draw-hint')).toBeHidden();
  await expect(page.getByTestId('draw-trend')).not.toHaveClass(/active/);
  let d = await drawings(page);
  expect(d.drawings.map((x) => x.kind)).toEqual(['trend']);
  // 찍은 자리에 붙는다 (가로는 봉 중앙으로 맞춤)
  const r = await chartRect(page);
  const h = d.handles[d.drawings[0].id];
  expect(Math.abs(h[0].x - (a[0] - r.left))).toBeLessThan(8);
  expect(Math.abs(h[0].y - (a[1] - r.top))).toBeLessThan(2);
  expect(Math.abs(h[1].y - (b[1] - r.top))).toBeLessThan(2);

  // 수평선: 1번, 평행 채널: 3번, 피보나치: 2번
  await page.getByTestId('draw-hline').click();
  await page.mouse.click(...(await at(page, 0.5, 0.2)));
  await page.getByTestId('draw-channel').click();
  await page.mouse.click(...(await at(page, 0.45, 0.8)));
  await page.mouse.click(...(await at(page, 0.6, 0.6)));
  await page.mouse.click(...(await at(page, 0.5, 0.85)));
  await page.getByTestId('draw-fib').click();
  await page.mouse.click(...(await at(page, 0.65, 0.85)));
  await page.mouse.click(...(await at(page, 0.8, 0.3)));
  d = await drawings(page);
  expect(d.drawings.map((x) => x.kind)).toEqual(['trend', 'hline', 'channel', 'fib']);
  expect(d.drawings.map((x) => x.points.length)).toEqual([2, 1, 3, 2]);
  expect(await visibleRange(page)).toEqual(range0); // 점 찍기가 차트를 움직이지 않음

  // 새로고침해도 남고, 종목마다 따로
  await page.reload();
  await waitLive(page);
  await expect.poll(async () => (await drawings(page)).drawings.length).toBe(4);
  await expect(page.getByTestId('draw-trend')).toBeVisible(); // 펼친 상태도 기억
  const symbol = page.getByTestId('symbol');
  await symbol.fill('DEMO-ETH');
  await symbol.press('Enter');
  await waitLive(page);
  expect((await drawings(page)).drawings).toHaveLength(0);
  await symbol.fill('DEMO-BTC');
  await symbol.press('Enter');
  await waitLive(page);
  await expect.poll(async () => (await drawings(page)).drawings.length).toBe(4);
});

test('a drawing can be selected, its end point dragged, moved as a whole, and deleted with Delete', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('draw-toggle').click();
  await page.getByTestId('draw-trend').click();
  await page.mouse.click(...(await at(page, 0.2, 0.7)));
  await page.mouse.click(...(await at(page, 0.45, 0.4)));
  const r = await chartRect(page);
  await page.mouse.click(r.left + 5 + r.width * 0.9, r.top + r.height * 0.1); // 빈 곳 → 선택 해제
  await expect.poll(async () => (await drawings(page)).selected).toBeNull();

  const d0 = (await drawings(page)).drawings[0];
  let hs = (await drawings(page)).handles[d0.id];
  // 선 가운데를 누르면 선택
  await page.mouse.click(r.left + (hs[0].x + hs[1].x) / 2, r.top + (hs[0].y + hs[1].y) / 2);
  await expect.poll(async () => (await drawings(page)).selected).toBe(d0.id);

  // 끝점 끌기: 끝점만 바뀐다
  const range0 = await visibleRange(page);
  await page.mouse.move(r.left + hs[1].x, r.top + hs[1].y);
  await page.mouse.down();
  await page.mouse.move(r.left + hs[1].x + 40, r.top + hs[1].y - 50, { steps: 6 });
  await page.mouse.up();
  const d1 = (await drawings(page)).drawings[0];
  expect(d1.points[0]).toEqual(d0.points[0]);
  expect(d1.points[1].price).toBeGreaterThan(d0.points[1].price);
  expect(d1.points[1].time).toBeGreaterThan(d0.points[1].time);
  expect(await visibleRange(page)).toEqual(range0); // 끄는 동안 차트는 그대로

  // 몸통 끌기: 두 점이 같이 움직인다
  hs = (await drawings(page)).handles[d0.id];
  const mid = { x: (hs[0].x + hs[1].x) / 2, y: (hs[0].y + hs[1].y) / 2 };
  await page.mouse.move(r.left + mid.x, r.top + mid.y);
  await page.mouse.down();
  await page.mouse.move(r.left + mid.x - 60, r.top + mid.y + 40, { steps: 6 });
  await page.mouse.up();
  const d2 = (await drawings(page)).drawings[0];
  expect(d2.points[0].time).toBeLessThan(d1.points[0].time);
  expect(d2.points[0].price).toBeLessThan(d1.points[0].price);
  expect(d2.points[1].time - d2.points[0].time).toBe(d1.points[1].time - d1.points[0].time);

  await page.keyboard.press('Delete');
  await expect.poll(async () => (await drawings(page)).drawings.length).toBe(0);
  await page.reload();
  await waitLive(page);
  expect((await drawings(page)).drawings).toHaveLength(0);
});

test('Esc cancels a drawing in progress; the trash button clears this symbol', async ({ page }) => {
  await open(page, { tf: '15' });
  await page.getByTestId('draw-toggle').click();
  await page.getByTestId('draw-channel').click();
  await page.mouse.click(...(await at(page, 0.3, 0.6)));
  await page.mouse.click(...(await at(page, 0.5, 0.4)));
  expect(await page.evaluate(() => window.__rrDebug.getDrawState())).toEqual({ tool: 'channel', placed: 2 });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__rrDebug.getDrawState())).toEqual({ tool: null, placed: 0 });
  expect((await drawings(page)).drawings).toHaveLength(0);

  await page.getByTestId('draw-hline').click();
  await page.mouse.click(...(await at(page, 0.5, 0.5)));
  await page.getByTestId('draw-hline').click();
  await page.mouse.click(...(await at(page, 0.5, 0.3)));
  expect((await drawings(page)).drawings).toHaveLength(2);
  await page.getByTestId('draw-clear').click();
  await expect(page.getByTestId('undo-text')).toContainText('작도 2개를 지웠습니다');
  expect((await drawings(page)).drawings).toHaveLength(0);
  // 되돌리면 두 개 다 돌아오고, 새로고침해도 남는다
  await page.getByTestId('undo-btn').click();
  await expect.poll(async () => (await drawings(page)).drawings.length).toBe(2);
  await page.reload();
  await waitLive(page);
  await expect.poll(async () => (await drawings(page)).drawings.length).toBe(2);
});

test('drawings are 1px; a selected drawing gets an edit bar to change its color, remembered for the next one', async ({ page }) => {
  await open(page, { tf: '15' });
  expect(await page.evaluate(() => window.__rrDebug.drawLineWidth())).toBe(1);
  await page.getByTestId('draw-toggle').click();
  await page.getByTestId('draw-trend').click();
  await page.mouse.click(...(await at(page, 0.2, 0.7)));
  await page.mouse.click(...(await at(page, 0.45, 0.4)));
  // 그리고 나면 선택된 채라 편집 막대가 뜬다
  const bar = page.getByTestId('draw-edit');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('draw-edit-name')).toHaveText('추세선');
  expect((await drawings(page)).drawings[0].color).toBeUndefined();

  await page.locator('[data-testid=draw-color-swatch][data-color="#F0616D"]').click();
  await expect.poll(async () => (await drawings(page)).drawings[0].color).toBe('#F0616D');
  await expect(page.locator('[data-testid=draw-color-swatch][data-color="#F0616D"]')).toHaveClass(/active/);
  await page.getByTestId('draw-color-input').fill('#12ab34');
  await expect.poll(async () => (await drawings(page)).drawings[0].color).toBe('#12ab34');

  // 다음 작도는 마지막 색으로
  await page.getByTestId('draw-hline').click();
  await expect(bar).toBeHidden(); // 도구를 고르면 편집 막대는 닫힌다
  await page.mouse.click(...(await at(page, 0.5, 0.25)));
  await expect.poll(async () => (await drawings(page)).drawings[1]?.color).toBe('#12ab34');

  // 기본색으로 되돌리기
  await page.getByTestId('draw-color-reset').click();
  await expect.poll(async () => (await drawings(page)).drawings[1].color).toBeUndefined();

  // 새로고침해도 색이 남는다
  await page.reload();
  await waitLive(page);
  await expect.poll(async () => (await drawings(page)).drawings.map((d) => d.color ?? null)).toEqual(['#12ab34', null]);

  // 편집 막대의 휴지통으로 지우기
  const d = await drawings(page);
  const hs = d.handles[d.drawings[0].id];
  const r = await chartRect(page);
  await page.mouse.click(r.left + (hs[0].x + hs[1].x) / 2, r.top + (hs[0].y + hs[1].y) / 2);
  await expect(bar).toBeVisible();
  await page.getByTestId('draw-delete').click();
  await expect.poll(async () => (await drawings(page)).drawings.map((x) => x.kind)).toEqual(['hline']);
  await expect(bar).toBeHidden();
});
