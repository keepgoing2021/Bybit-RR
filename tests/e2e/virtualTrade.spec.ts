import { expect, test, type Page } from '@playwright/test';

// 가상 거래 (2026-11-11): 차트 박스 옆 「진입」 한 번 → 저널 진행 중 → 손절·목표에 닿으면 자동 청산
const MIN = 60_000;
const journal = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.journal') ?? '{"trades":[]}'));
const scenarioId = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.state') ?? '{}').scenario?.id ?? null);

async function openCalc(page: Page) {
  await page.goto('/tests/harness/index.html?speed=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('tf').selectOption('15');
  await expect(page.getByTestId('btn-long')).toBeEnabled({ timeout: 20_000 });
}

for (const [name, size] of [['PC', { width: 1280, height: 800 }], ['폰', { width: 390, height: 844 }]] as const) {
  test(`진입 버튼 (${name}): 한 번 누르면 저널 진행 중, 계산은 그대로, 되돌리기`, async ({ page }) => {
    await page.setViewportSize(size);
    await openCalc(page);
    await expect(page.getByTestId('vt-action')).toBeHidden();
    await page.getByTestId('btn-long').click();
    await expect.poll(() => scenarioId(page)).not.toBeNull();
    const id = await scenarioId(page);
    const enter = page.getByTestId('vt-enter');
    await expect(enter).toBeVisible();
    await expect(enter).toBeEnabled();
    // 차트 안에 온전히 보인다
    const box = (await enter.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    await enter.click();
    const j = await journal(page);
    expect(j.trades).toHaveLength(1);
    expect(j.trades[0].id).toBe(id);
    expect(j.trades[0].exit).toBeNull();
    expect(j.trades[0].sl).toBeGreaterThan(0);
    expect(await scenarioId(page)).toBe(id); // 누름이 차트로 새서 계산이 바뀌지 않았다
    await expect(page.getByTestId('vt-open')).toBeVisible();
    await expect(enter).toBeHidden();
    await expect(page.getByTestId('undo-text')).toContainText('가상 진입했어요');
    await page.getByTestId('undo-btn').click();
    expect((await journal(page)).trades).toHaveLength(0);
    await expect(enter).toBeVisible();
    // 새로고침해도 진입한 계산은 「진행 중」
    await enter.click();
    await page.reload();
    await expect(page.getByTestId('vt-open')).toBeVisible({ timeout: 20_000 });
    expect((await journal(page)).trades).toHaveLength(1);
  });
}

test('저널: 손절에 닿은 열린 거래를 자동 청산하고 알린다 · 「지금 가격으로」', async ({ page }) => {
  const opened = Date.now() - 10 * MIN;
  const trade = (id: string, symbol: string) => ({
    id, symbol, side: 'LONG', entry: 100, sl: 98, tp: 104, qty: null, riskUsdt: 10, riskPct: 1,
    openedAt: opened, closedAt: null, exit: null, setup: '', quality: 'rule', reason: '', rules: [], feeRate: 0.00055,
  });
  await page.route('**/v5/market/kline*', async (route) => {
    const u = new URL(route.request().url());
    const start = Number(u.searchParams.get('start'));
    const end = Number(u.searchParams.get('end'));
    const hit = u.searchParams.get('symbol') === 'BTCUSDT';
    const list: string[][] = [];
    for (let t = end - (end % MIN); t >= start; t -= MIN) list.push([String(t), '100', '101', hit && t === start + 3 * MIN ? '97' : '99', '100', '1', '1']);
    await route.fulfill({ json: { retCode: 0, result: { list } } });
  });
  await page.route('**/v5/market/tickers*', (route) => route.fulfill({ json: { retCode: 0, result: { list: [{ symbol: 'ETHUSDT', lastPrice: '101.5' }] } } }));
  await page.goto('/journal.html');
  await page.evaluate((trades) => {
    localStorage.clear();
    localStorage.setItem('rrtool.v1.journal', JSON.stringify({ version: 1, trades, settings: {} }));
  }, [trade('a', 'BTCUSDT'), trade('e', 'ETHUSDT')]);
  await page.reload();
  await expect(page.locator('.j-toast').first()).toContainText('BTC 롱 손절 닿음');
  await expect(page.getByTestId('j-open')).toContainText('진행 중 1');
  await expect(page.getByTestId('j-closed')).toContainText('끝난 거래 1');
  await expect(page.getByTestId('j-auto-a')).toContainText('자동 · 손절');
  const saved = (await journal(page)).trades;
  expect(saved.find((t: { id: string }) => t.id === 'a')).toMatchObject({ exit: 98, auto: 'sl' });
  expect(saved.find((t: { id: string }) => t.id === 'e').trackedTo).toBeGreaterThan(opened);
  await page.getByTestId('j-now-e').click();
  await expect(page.getByTestId('j-exit-e')).toHaveValue('101.5');
  await expect(page.getByTestId('j-preview-e')).toContainText('+0.75R');
});
