import { expect, test } from '@playwright/test';

// 차트만 크게 (2026-11-15): ⤢ 로 차트가 창 전체, 다시 누르거나 Esc로 돌아온다 · 폰을 눕혀도 그대로 전체
const rect = (page: import('@playwright/test').Page) => page.getByTestId('chart').evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);

test('PC: ⤢ → 차트가 창 전체, Esc로 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/tests/harness/index.html?speed=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
  const before = await rect(page);
  await page.getByTestId('chart-full').click();
  const full = await rect(page);
  expect(full.width).toBeGreaterThan(before.width);
  expect(full.height).toBeGreaterThanOrEqual(780);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chart-full')).toHaveAttribute('aria-pressed', 'false');
  expect((await rect(page)).width).toBeCloseTo(before.width, 0);
});

test('폰 가로: 전체 화면이면 차트가 화면을 꽉 채운다', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/tests/harness/index.html?speed=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('chart-full').click();
  const r = await rect(page);
  expect(r.width).toBeGreaterThanOrEqual(844 - 24); // 왼쪽 22px는 작도 도구 손잡이 자리
  expect(r.height).toBeGreaterThanOrEqual(385);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/m-land.png` });
});
