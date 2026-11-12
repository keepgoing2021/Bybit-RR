import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// 저널 백업 · 복원 (2026-11-11): 파일로 내려받고, 저장소를 비운 브라우저에서 다시 불러온다
const trade = (id: string, exit: number | null) => ({
  id, symbol: 'BTCUSDT', side: 'LONG', entry: 100, sl: 98, tp: 104, qty: 1, riskUsdt: 2, riskPct: 1,
  openedAt: Date.now() - 7200_000, closedAt: exit === null ? null : Date.now() - 3600_000, exit,
  setup: '스윕 반전', quality: 'rule', reason: '백업 시험', rules: [], feeRate: 0.00055,
});

// 가상 거래 자동 추적이 진짜 Bybit 시세로 시험용 거래를 청산하지 않게 막는다
test.beforeEach(async ({ page }) => {
  await page.route('**/v5/market/**', (r) => r.abort());
});

test('journal: 백업 저장 → 저장소 비움 → 백업 불러오기로 되살린다 (지금 기록은 안 지움)', async ({ page }) => {
  await page.goto('/journal.html');
  await page.evaluate((trades) => {
    localStorage.setItem('rrtool.v1.journal', JSON.stringify({ version: 1, trades, settings: { setups: ['내 셋업'] } }));
  }, [trade('a', 104), trade('b', null)]);
  await page.reload();
  await expect(page.getByTestId('j-local')).toContainText('아직 백업 안 함');
  await expect(page.getByTestId('j-closed')).toContainText('끝난 거래 1');

  // 머리글의 안내를 누르면 설정 탭 「백업·내보내기」로 간다 (2026-11-12: 백업 버튼을 거기로 모았다)
  await page.getByTestId('j-local').click();
  await expect(page.getByTestId('j-backup')).toBeInViewport();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('j-backup').click()]);
  expect(dl.suggestedFilename()).toMatch(/^1rc-journal-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await dl.path();
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(saved.app).toBe('1rc-journal');
  expect(saved.trades).toHaveLength(2);
  await expect(page.getByTestId('j-local')).toContainText('오늘 백업함');

  // 브라우저 기록을 지운 것처럼 + 그 뒤 새 거래 하나
  await page.evaluate((t) => {
    localStorage.clear();
    localStorage.setItem('rrtool.v1.journal', JSON.stringify({ version: 1, trades: [t], settings: {} }));
  }, trade('c', 98));
  await page.reload();
  await expect(page.getByTestId('j-closed')).toContainText('끝난 거래 1');

  await page.getByTestId('j-restore-file').setInputFiles(path);
  await expect(page.locator('.j-toast')).toContainText('2건 불러왔어요');
  await expect(page.getByTestId('j-closed')).toContainText('끝난 거래 2');
  await expect(page.getByTestId('j-open')).toContainText('진행 중 1');
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('rrtool.v1.journal')!).trades.map((t: { id: string }) => t.id).sort());
  expect(ids).toEqual(['a', 'b', 'c']);
});

test('journal: 백업이 아닌 파일은 거절하고 기록을 건드리지 않는다', async ({ page }) => {
  await page.goto('/journal.html');
  await page.evaluate((t) => localStorage.setItem('rrtool.v1.journal', JSON.stringify({ version: 1, trades: [t], settings: {} })), trade('a', 104));
  await page.reload();
  await page.getByTestId('j-restore-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('.j-toast')).toContainText('1RC 백업 파일이 아니에요');
  await expect(page.getByTestId('j-closed')).toContainText('끝난 거래 1');
});
