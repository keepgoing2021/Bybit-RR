import { expect, test, type Page } from '@playwright/test';

// 2026-11-11 검토 수정: 오래된 계산 알림 · 수수료까지 넣어 손실 맞추기
const SHOTS = process.env.SHOT_DIR;

async function open(page: Page) {
  await page.goto('/tests/harness/index.html?speed=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('tf').selectOption('15');
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
}

test('어제 계산이 남아 있으면 날짜·경과 시간·지금 가격과의 차이를 알린다 (방금 계산은 조용)', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-long').click();
  await expect(page.getByTestId('entry-time')).toContainText('로 계산');
  await expect(page.getByTestId('plan-old')).toBeHidden();
  // 저장된 계산을 26시간 전 것으로
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.state') ?? '{}').scenario?.id ?? null)).not.toBeNull();
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('rrtool.v1.state')!);
    st.scenario.clickedAt -= 26 * 3600_000;
    st.scenario.priceTime -= 26 * 3600_000;
    localStorage.setItem('rrtool.v1.state', JSON.stringify(st));
  });
  await page.reload();
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
  const note = page.getByTestId('plan-old');
  await expect(note).toBeVisible();
  await expect(note).toHaveAttribute('data-warn', 'true');
  await expect(note).toContainText(/1일 전 계산 · 지금 가격은 진입가보다 (0\.0|[+−]\d+\.\d)%/);
  await expect(note).toContainText('다시 눌러 새로 계산');
  await expect(page.getByTestId('entry-time')).toContainText(/\d+월 \d+일 \d{2}:\d{2}/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan-old.png` });
  // 다시 누르면 사라진다
  await page.getByTestId('btn-long').click();
  await expect(note).toBeHidden();
});

test('수수료까지 넣어 손실 맞추기: 자산 % 방식에서 켜면 포지션이 줄고 「수수료 포함」 합계가 한도와 같다', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-long').click();
  await page.getByTestId('sizing-capital').fill('10,000');
  await page.getByTestId('sizing-capital').press('Enter');
  const sw = page.getByTestId('sizing-fee-include');
  // 기본(투입금 방식)에서는 잠겨 있다
  await expect(sw).toBeDisabled();
  await page.getByTestId('sizing-mode-risk').click();
  await expect(sw).toBeEnabled();
  await expect(sw).not.toBeChecked();
  const num = (t: string | null) => Number((t ?? '').replace(/[^\d.]/g, ''));
  const total = async () => num(await page.getByTestId('sizing-total').textContent());
  const before = await total();
  await sw.check();
  await expect.poll(total).toBeLessThan(before);
  const loss = page.getByTestId('sizing-loss');
  await expect(loss).toContainText('수수료 포함 −');
  const withFee = num((await loss.textContent())!.split('수수료 포함')[1]);
  expect(withFee).toBeLessThanOrEqual(100.01);
  expect(withFee).toBeGreaterThan(98);
  if (SHOTS) await page.getByTestId('sizing-summary').screenshot({ path: `${SHOTS}/fee-include.png` });
  await page.reload();
  await expect(page.getByTestId('sizing-fee-include')).toBeChecked();
});
