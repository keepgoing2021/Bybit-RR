import { expect, test, type Page } from '@playwright/test';

// 하루 중 거래대금이 가장 큰 캔들 표시 (2026-11-11): 「🔥 $… · N배」 이름표 + 가격 구간 띠, 켜고 끄기, 일봉에서는 숨김

type Box = { time: number; usd: number; text: string; x: number; y: number; w: number; h: number; above: boolean; band: { x1: number; x2: number; yTop: number; yBottom: number } };
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
    // 가격 구간 띠: 캔들에서 오른쪽으로, 두께는 그 캔들의 고가~저가
    expect(b.band.x2).toBeGreaterThan(b.band.x1);
    expect(b.band.yBottom).toBeGreaterThan(b.band.yTop);
    expect(b.usd).toBeGreaterThan(0);
  }
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-pc.png` });
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

test('폰에서도 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalc(page);
  await expect.poll(async () => (await boxes(page)).length).toBeGreaterThan(0);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/vol-phone.png` });
});
