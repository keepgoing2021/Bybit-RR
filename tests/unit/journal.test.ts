import { describe, expect, it } from 'vitest';
import {
  autoRiskPct, backupAgeText, computeStats, emptyJournal, entryWarnings, grossR, groupStats, limitStatus, mergeJournal, parseBackup, parseJournal, periodStart, sessionOf, toBackup, toCsv, tradeResult, type Trade,
} from '../../src/core/journal';

const H = 3600_000;
// 2026-11-06 12:00 KST = 03:00 UTC
const NOW = Date.UTC(2026, 10, 6, 3, 0);
let seq = 0;
function trade(p: Partial<Trade> = {}): Trade {
  return {
    id: `t${++seq}`, symbol: 'BTCUSDT', side: 'LONG', entry: 100, sl: 98, tp: 104, qty: null, riskUsdt: 50, riskPct: 1,
    openedAt: NOW - 2 * H, closedAt: null, exit: null, setup: '스윕 반전', quality: 'rule', reason: '', rules: [], feeRate: 0.00055, ...p,
  };
}
const closed = (exit: number, p: Partial<Trade> = {}) => trade({ exit, closedAt: NOW - H, ...p });

describe('저널 계산', () => {
  it('R: 손절폭 대비 몇 배 (롱·숏)', () => {
    expect(grossR(trade(), 104)).toBe(2);
    expect(grossR(trade(), 98)).toBe(-1);
    expect(grossR(trade({ side: 'SHORT', entry: 100, sl: 102 }), 97)).toBe(1.5);
    expect(grossR(trade({ sl: 100 }), 104)).toBeNull();
  });

  it('수량이 있으면 수수료(진입+청산) 뺀 순손익과 R', () => {
    const res = tradeResult(closed(104, { qty: 10, feeRate: 0.001 }))!;
    // 가격 이익 40, 수수료 0.001×10×(100+104)=2.04 → 37.96, R = 37.96/(10×2)
    expect(res.pnl).toBeCloseTo(37.96, 6);
    expect(res.r).toBeCloseTo(1.898, 6);
    expect(res.outcome).toBe('win');
  });

  it('수량이 없으면 riskUsdt × R, 본전은 ±0.05R', () => {
    expect(tradeResult(closed(98))).toEqual({ r: -1, pnl: -50, outcome: 'loss' });
    expect(tradeResult(closed(100.05))!.outcome).toBe('be');
    expect(tradeResult(trade())).toBeNull(); // 아직 진행 중
  });

  it('요약: 승률·기대값·평균 손익비·RCR·규칙 위반 손익', () => {
    const s = computeStats([closed(104), closed(103), closed(98), closed(98, { quality: 'break' }), closed(100), trade()]);
    expect(s.trades).toBe(5);
    expect([s.wins, s.losses, s.breakeven]).toEqual([2, 2, 1]);
    expect(s.winRate).toBe(0.5);
    expect(s.expectancyR).toBeCloseTo((2 + 1.5 - 1 - 1 + 0) / 5, 9);
    expect(s.avgRR).toBeCloseTo(1.75, 9);
    expect(s.rcr).toBeCloseTo(0.8, 9);
    expect(s.ruleBreaks).toBe(1);
    expect(s.ruleBreakPnl).toBe(-50);
    expect(computeStats([]).winRate).toBeNull();
  });

  it('묶음별 성과: 10건 미만 묶음은 뺀다 (적은 표본의 우연 거르기)', () => {
    const list = [...Array.from({ length: 10 }, () => closed(104, { setup: 'A' })), ...Array.from({ length: 4 }, () => closed(98, { setup: 'B' }))];
    const g = groupStats(list, (t) => t.setup);
    expect(g.map((x) => x.key)).toEqual(['A']);
    expect(groupStats(list, (t) => t.setup, 3).map((x) => x.key)).toEqual(['A', 'B']);
  });

  it('세션 (UTC)', () => {
    expect(sessionOf(Date.UTC(2026, 0, 1, 2))).toBe('아시아');
    expect(sessionOf(Date.UTC(2026, 0, 1, 8))).toBe('런던');
    expect(sessionOf(Date.UTC(2026, 0, 1, 14))).toBe('뉴욕 오전');
    expect(sessionOf(Date.UTC(2026, 0, 1, 19))).toBe('뉴욕 오후');
  });
});

describe('한도·진입 전 경고·리스크 자동 조절', () => {
  it('한국 시간 기준 하루·주(월요일)·달 시작', () => {
    expect(periodStart(NOW, 'day')).toBe(Date.UTC(2026, 10, 5, 15)); // 11/6 00:00 KST
    expect(periodStart(NOW, 'week')).toBe(Date.UTC(2026, 10, 1, 15)); // 11/2(월) 00:00 KST
    expect(periodStart(NOW, 'month')).toBe(Date.UTC(2026, 9, 31, 15)); // 11/1 00:00 KST
  });

  it('하루 손실 한도 초과면 빨강', () => {
    const t = [closed(98), closed(98), closed(98)];
    const st = limitStatus(t, { daily: 3, weekly: 6, monthly: 10 }, NOW);
    expect(st[0]).toMatchObject({ period: 'day', r: -3, exceeded: true });
    expect(st[1].exceeded).toBe(false);
  });

  it('LONG/SHORT 경고: 하루 최대 거래 수, 오늘 N연속 손절', () => {
    const j = emptyJournal();
    j.settings.daily = { maxTradesPerDay: 3, stopAfterLosses: 2 };
    j.settings.limits.daily = 0;
    j.trades = [closed(104, { closedAt: NOW - 3 * H }), closed(98, { closedAt: NOW - 2 * H }), closed(98, { closedAt: NOW - H })];
    const w = entryWarnings(j, NOW);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('하루 최대 3번');
    expect(w[1]).toContain('2연속 손절');
    j.trades.push(closed(104, { closedAt: NOW - 0.5 * H, openedAt: NOW - 30 * H }));
    expect(entryWarnings(j, NOW).some((x) => x.includes('연속'))).toBe(false); // 마지막이 익절이면 연패 끊김
  });

  it('리스크 자동 조절: 누적 수익률 기준 이상이면 높은 %, 꺼져 있거나 자산 모르면 null', () => {
    const j = emptyJournal();
    j.trades = [closed(104, { riskUsdt: 100 })]; // +200
    expect(autoRiskPct(j, 10_000)).toBeNull();
    j.settings.autoRisk = { enabled: true, basePct: 0.5, upPct: 1, thresholdPct: 2 };
    expect(autoRiskPct(j, 10_000)).toBe(1); // +2%
    expect(autoRiskPct(j, 20_000)).toBe(0.5); // +1%
    expect(autoRiskPct(j, null)).toBeNull();
  });
});

describe('저장·내보내기', () => {
  it('깨진 값은 버리고 기본값으로', () => {
    expect(parseJournal(null).trades).toEqual([]);
    expect(parseJournal('{bad').settings.rules.length).toBeGreaterThan(0);
    const raw = JSON.stringify({ version: 1, trades: [trade(), { id: 'x', symbol: '<b>', side: 'LONG' }, { ...trade(), quality: 'weird' }], settings: { rules: Array(20).fill('r').map((r, i) => r + i), daily: { maxTradesPerDay: -1 } } });
    const j = parseJournal(raw);
    expect(j.trades).toHaveLength(2);
    expect(j.trades[1].quality).toBe('rule');
    expect(j.settings.rules).toHaveLength(8);
    expect(j.settings.daily.maxTradesPerDay).toBe(5);
  });

  it('CSV: 쉼표·따옴표 감싸기, 엑셀 수식 주입 막기', () => {
    const csv = toCsv([closed(104, { reason: '=HYPERLINK("x"), 좋음' })]);
    const line = csv.split('\n')[1];
    expect(line).toContain(`"'=HYPERLINK(""x""), 좋음"`);
    expect(line).toContain('2.00');
  });
});

describe('백업 · 복원', () => {
  it('내려받은 백업을 그대로 다시 읽는다 (거래 + 설정)', () => {
    const j = emptyJournal();
    j.trades = [trade(), closed(104, { qty: 10 })];
    j.settings.setups = ['내 셋업'];
    const read = parseBackup(toBackup(j, NOW));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.journal.trades).toEqual(j.trades);
    expect(read.journal.settings).toEqual(j.settings);
    expect(read.skipped).toBe(0);
  });

  it('1RC 백업이 아니면 거절한다 (CSV · 다른 JSON · 너무 큰 파일)', () => {
    expect(parseBackup(toCsv([trade()])).ok).toBe(false);
    expect(parseBackup('{"version":1,"trades":[]}').ok).toBe(false);
    expect(parseBackup('[]').ok).toBe(false);
    expect(parseBackup('null').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: '1rc-journal', version: 2, trades: [] })).ok).toBe(false);
    expect(parseBackup('x'.repeat(5_000_001)).ok).toBe(false);
  });

  it('깨진 줄·겹친 id는 건너뛰고 센다', () => {
    const t = trade();
    const raw = JSON.stringify({ app: '1rc-journal', version: 1, trades: [t, { id: 'bad' }, t, { ...trade(), symbol: '<script>' }], settings: null });
    const read = parseBackup(raw);
    expect(read.ok && read.journal.trades).toEqual([t]);
    expect(read.ok && read.skipped).toBe(3);
  });

  it('합치기: 지금 기록은 안 지우고, 없는 것만 더한다', () => {
    const mine = emptyJournal();
    const a = trade();
    const b = closed(104);
    const openHere = trade();
    mine.trades = [a, b, openHere];
    mine.settings.setups = ['지금 셋업'];
    const backup = emptyJournal();
    const c = closed(98);
    // a: 백업에선 다른 값이지만 지금 것 유지 / openHere: 백업에선 청산됨 → 백업 것
    backup.trades = [{ ...a, reason: '옛 메모' }, { ...openHere, exit: 104, closedAt: NOW }, c];
    const m = mergeJournal(mine, backup);
    expect([m.added, m.updated, m.kept]).toEqual([1, 1, 1]);
    expect(m.journal.trades.map((t) => t.id).sort()).toEqual([a.id, b.id, openHere.id, c.id].sort());
    expect(m.journal.trades.find((t) => t.id === a.id)!.reason).toBe('');
    expect(m.journal.trades.find((t) => t.id === openHere.id)!.exit).toBe(104);
    expect(m.journal.settings.setups).toEqual(['지금 셋업']);
  });

  it('빈 저널(새 브라우저)이면 설정도 백업 것으로', () => {
    const backup = emptyJournal();
    backup.trades = [closed(104)];
    backup.settings.setups = ['백업 셋업'];
    const m = mergeJournal(emptyJournal(), backup);
    expect(m.added).toBe(1);
    expect(m.journal.settings.setups).toEqual(['백업 셋업']);
  });

  it('백업한 지 며칠 됐는지', () => {
    expect(backupAgeText(null, NOW)).toBeNull();
    expect(backupAgeText(NOW - H, NOW)).toBe('오늘 백업함');
    expect(backupAgeText(NOW - 3 * 24 * H - H, NOW)).toBe('백업 3일 전');
    expect(backupAgeText(NOW + 24 * H, NOW)).toBeNull();
  });
});
