import { expect, test, type Page } from '@playwright/test';

// 하루 중 거래대금이 가장 큰 캔들 표시 (2026-11-11): 「🔥 $… · N배」 이름표 (누르면 고가·저가 점선), 켜고 끄기, 일봉에서는 숨김

type Box = { time: number; usd: number; text: string; x: number; y: number; w: number; h: number; above: boolean; open: boolean; band: { x1: number; x2: number; yTop: number; yBottom: number } };
const boxes = (page: Page) => page.evaluate(() => (window as unknown as { __rrDebug: { getVolumePeakBoxes(): Box[] } }).__rrDebug.getVolumePeakBoxes());

async function openCalc(page: Page) {
  await page.goto('/tests/harness/index.html?speed=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('tf').selectOption('15');
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
}

test('하루마다 하나씩 이름표가 붙고, 버튼으로 끄면 사라지고 새로고침해도 기억한다', async ({ page }) => {
  await openCalc(page);
  const toggle = page.getByTestId('volpeak-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  const list = await boxes(page);
  // 하루(UTC 자정 경계)에 하나만
  const days = list.map((b) => Math.floor(b.time / 86_400_000));
  expect(new Set(days).size).toBe(days.length);
  for (const b of list) {
    // 금액 + 평소(앞 20봉 평균) 대비 배수
    expect(b.text).toMatch(/^🔥 ≈?\$[\d.]+[KMB]?( · [\d.]+배)?$/);
    // 평소에는 이름표만 (가격 구간 선은 접혀 있다)
    expect(b.open).toBe(false);
    expect(b.band.x2).toBeGreaterThan(b.band.x1);
    expect(b.band.yBottom).toBeGreaterThan(b.band.yTop);
    expect(b.usd).toBeGreaterThan(0);
  }
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-pc.png` });
  // 이름표를 누르면 그 캔들만 선이 펼쳐지고, 다시 누르면 접힌다. 계산(박스)은 생기지 않는다
  const chart = (await page.locator('.chart-wrap .chart').boundingBox())!;
  const target = list[list.length - 1];
  const tap = () => page.mouse.click(chart.x + target.x + target.w / 2, chart.y + target.y + target.h / 2);
  const openTimes = async () => (await boxes(page)).filter((b) => b.open).map((b) => b.time);
  await tap();
  await expect.poll(openTimes).toEqual([target.time]);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-pc-open.png` });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.state') ?? '{}').scenario ?? null)).toBeNull();
  await tap();
  await expect.poll(openTimes).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await boxes(page)).length).toBe(0);
  await page.reload();
  await expect(page.getByTestId('volpeak-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('volpeak-toggle').click();
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
});

test('일봉에서는 표시하지 않는다', async ({ page }) => {
  await openCalc(page);
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  await page.getByTestId('tf').selectOption('D');
  await expect.poll(async () => (await boxes(page)).length).toBe(0);
});

test('넓게 보면(4시간봉) 한 주에 하나로 바뀌고 이름표끼리 겹치지 않는다 · 15분봉으로 돌아오면 다시 하루', async ({ page }) => {
  await openCalc(page);
  await expect(page.getByTestId('volpeak-period')).toHaveText(' · 하루');
  await page.getByTestId('tf').selectOption('240');
  await expect(page.getByTestId('volpeak-period')).toHaveText(' · 한 주');
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  const list = await boxes(page);
  // 한 주(월요일 UTC 자정 경계)에 하나만
  const weeks = list.map((b) => Math.floor((b.time / 86_400_000 - 4) / 7));
  expect(new Set(weeks).size).toBe(weeks.length);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.text} / ${b.text}`).toBe(false);
    }
  }
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-4h.png` });
  await page.getByTestId('tf').selectOption('15');
  await expect(page.getByTestId('volpeak-period')).toHaveText(' · 하루');
});

test('폰에서도 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalc(page);
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-phone.png` });
});
