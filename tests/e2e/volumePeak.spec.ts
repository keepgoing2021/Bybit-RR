import { expect, test, type Page } from '@playwright/test';

// 거래대금이 가장 큰 캔들 표시: 「🔥 $… · N배」 이름표 (누르면 고가·저가 점선).
// 버튼을 누를 때마다 파동마다(기본) → 하루마다(넓게 보면 한 주) → 끔. 일봉에서는 숨김

type Box = { time: number; usd: number; text: string; x: number; y: number; w: number; h: number; above: boolean; open: boolean; band: { x1: number; x2: number; yTop: number; yBottom: number } };
const boxes = (page: Page) => page.evaluate(() => (window as unknown as { __rrDebug: { getVolumePeakBoxes(): Box[] } }).__rrDebug.getVolumePeakBoxes());

async function openCalc(page: Page) {
  await page.goto('/tests/harness/index.html?speed=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('tf').selectOption('15');
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
}

const period = (page: Page) => page.getByTestId('volpeak-period');
const noOverlap = (list: Box[]) => {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.text} / ${b.text}`).toBe(false);
    }
  }
};

test('기본은 파동마다: 이름표가 붙고 서로·범례와 겹치지 않는다. 누르면 그 캔들만 선이 펼쳐진다', async ({ page }) => {
  await openCalc(page);
  const toggle = page.getByTestId('volpeak-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(period(page)).toHaveText(' · 파동');
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  const list = await boxes(page);
  noOverlap(list);
  const chart = (await page.locator('.chart-wrap .chart').boundingBox())!;
  for (const b of list) {
    expect(b.text).toMatch(/^🔥 ≈?\$[\d.]+[KMB]?( · [\d.]+배)?$/);
    expect(b.open).toBe(false);
    expect(b.usd).toBeGreaterThan(0);
    // 왼쪽 위 버튼(다우 구조·거래 터진 곳)을 덮지 않는다
    for (const id of ['volpeak-toggle']) {
      const r = (await page.getByTestId(id).boundingBox())!;
      const bx = chart.x + b.x;
      const by = chart.y + b.y;
      expect(bx < r.x + r.width && r.x < bx + b.w && by < r.y + r.height && r.y < by + b.h, `${b.text} 가 버튼을 덮음`).toBe(false);
    }
  }
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-pc.png` });
  // 이름표를 누르면 그 캔들만 선이 펼쳐지고, 다시 누르면 접힌다. 계산(박스)은 생기지 않는다
  const target = list[list.length - 1];
  const tap = () => page.mouse.click(chart.x + target.x + target.w / 2, chart.y + target.y + target.h / 2);
  const openTimes = async () => (await boxes(page)).filter((b) => b.open).map((b) => b.time);
  await tap();
  await expect.poll(openTimes).toEqual([target.time]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.state') ?? '{}').scenario ?? null)).toBeNull();
  await tap();
  await expect.poll(openTimes).toEqual([]);
});

test('버튼을 누를 때마다 파동 → 하루 → 끔 → 파동, 새로고침해도 기억한다', async ({ page }) => {
  await openCalc(page);
  const toggle = page.getByTestId('volpeak-toggle');
  await expect(period(page)).toHaveText(' · 파동');
  await toggle.click();
  await expect(period(page)).toHaveText(' · 하루');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  // 하루(UTC 자정 경계)에 하나만
  await expect.poll(async () => {
    const days = (await boxes(page)).map((b) => Math.floor(b.time / 86_400_000));
    return days.length > 0 && new Set(days).size === days.length;
  }).toBe(true);
  await page.reload();
  await expect(period(page)).toHaveText(' · 하루');
  await page.getByTestId('volpeak-toggle').click();
  await expect(page.getByTestId('volpeak-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(period(page)).toHaveText('');
  await expect.poll(async () => (await boxes(page)).length).toBe(0);
  await page.reload();
  await expect(page.getByTestId('volpeak-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('volpeak-toggle').click();
  await expect(period(page)).toHaveText(' · 파동');
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
});

test('일봉에서는 표시하지 않는다', async ({ page }) => {
  await openCalc(page);
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  await page.getByTestId('tf').selectOption('D');
  await expect.poll(async () => (await boxes(page)).length).toBe(0);
});

test('하루 기준: 넓게 보면(4시간봉) 한 주에 하나로 바뀌고 겹치지 않는다 · 15분봉으로 돌아오면 다시 하루', async ({ page }) => {
  await openCalc(page);
  await page.getByTestId('volpeak-toggle').click();
  await expect(period(page)).toHaveText(' · 하루');
  await page.getByTestId('tf').selectOption('240');
  await expect(period(page)).toHaveText(' · 한 주');
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  const list = await boxes(page);
  const weeks = list.map((b) => Math.floor((b.time / 86_400_000 - 4) / 7));
  expect(new Set(weeks).size).toBe(weeks.length);
  noOverlap(list);
  await page.getByTestId('tf').selectOption('15');
  await expect(period(page)).toHaveText(' · 하루');
});

test('파동 기준은 시간봉마다 다시 잡는다 (1시간봉·4시간봉에서도 겹치지 않게 보인다)', async ({ page }) => {
  await openCalc(page);
  for (const tf of ['60', '240']) {
    await page.getByTestId('tf').selectOption(tf);
    await expect(period(page)).toHaveText(' · 파동');
    await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
    noOverlap(await boxes(page));
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-wave-${tf}.png` });
  }
});

test('폰에서도 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalc(page);
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-phone.png` });
});
