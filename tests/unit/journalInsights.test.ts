import { describe, expect, it } from 'vitest';
import { emptyJournal, periodStart, type Trade } from '../../src/core/journal';
import {
  avgHoldMs, cumulativeR, currentFix, dailyTotals, dayKey, lastDayKeys, maxDrawdownR, maxStreaks, monthCells, monthlyRows, pendingReviewWeek, recordStreak, score, weakestSpot, weekSummary,
} from '../../src/core/journalInsights';

const H = 3600_000;
const D = 24 * H;
// 2026-11-11(수) 12:00 KST
const NOW = Date.UTC(2026, 10, 11, 3, 0);
let seq = 0;
/** r배 결과로 끝난 거래 (롱 100, 손절 98 → 청산가 100 + 2r). riskUsdt만 있어 수수료 없음 */
function tr(r: number | null, closedAt: number | null = NOW - H, p: Partial<Trade> = {}): Trade {
  return {
    id: `t${++seq}`, symbol: 'BTCUSDT', side: 'LONG', entry: 100, sl: 98, tp: null, qty: null, riskUsdt: 10, riskPct: 1,
    openedAt: (closedAt ?? NOW) - H, closedAt: r === null ? null : closedAt, exit: r === null ? null : 100 + 2 * r,
    setup: 'A', quality: 'rule', reason: '', rules: [], feeRate: 0.00055, ...p,
  };
}
const full = { closeRule: 'kept', mood: 'calm' } as const;

describe('저널 인사이트', () => {
  it('dayKey: 한국 날짜', () => {
    expect(dayKey(Date.UTC(2026, 10, 8, 14, 59))).toBe('2026-11-08');
    expect(dayKey(Date.UTC(2026, 10, 8, 15, 0))).toBe('2026-11-09');
  });

  it('dailyTotals: 청산한 날로 묶고, 열린 거래·계산 안 되는 거래는 뺀다', () => {
    const m = dailyTotals([tr(2), tr(-1), tr(null), tr(1, NOW - H, { sl: 100 }), tr(1, NOW - D)]);
    expect(m.get('2026-11-11')).toEqual({ r: 1, n: 2 });
    expect(m.get('2026-11-10')).toEqual({ r: 1, n: 1 });
    expect(m.size).toBe(2);
  });

  it('monthCells: 일요일 시작, 앞 빈칸은 null', () => {
    const nov = monthCells(2026, 10);
    expect(nov).toHaveLength(30);
    expect(nov[0]).toBe('2026-11-01');
    const dec = monthCells(2026, 11);
    expect(dec.slice(0, 3)).toEqual([null, null, '2026-12-01']);
    expect(dec).toHaveLength(33);
  });

  it('lastDayKeys: 오래된 날 → 오늘', () => {
    expect(lastDayKeys(NOW, 3)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
  });

  it('score: 10개 미만이면 null, 만점 100', () => {
    expect(score(Array.from({ length: 9 }, () => tr(1, NOW - H, full)), NOW)).toBeNull();
    expect(score([], NOW)).toBeNull();
    const best = score(Array.from({ length: 10 }, () => tr(1, NOW - H, full)), NOW)!;
    expect(best).toEqual({ total: 100, profit: 25, rules: 25, loss: 25, consistency: 25 });
  });

  it('score: 전부 −1R·칩 없음 → 50, 큰 손실 절반 → 손실 관리 12.5, 31일 전은 안 셈', () => {
    const s = score(Array.from({ length: 10 }, () => tr(-1)), NOW)!;
    expect(s).toEqual({ total: 50, profit: 0, rules: 25, loss: 25, consistency: 0 });
    const half = score([...Array.from({ length: 5 }, () => tr(-2)), ...Array.from({ length: 5 }, () => tr(-1))], NOW)!;
    expect(half.loss).toBe(12.5);
    const old = [...Array.from({ length: 9 }, () => tr(1, NOW - H, full)), tr(1, NOW - 31 * D, full)];
    expect(score(old, NOW)).toBeNull();
  });

  it('score: 규칙 위반 칩은 규칙 점수를 깎는다', () => {
    const list = [...Array.from({ length: 5 }, () => tr(1, NOW - H, full)), ...Array.from({ length: 5 }, () => tr(1, NOW - H, { closeRule: 'movedSl', mood: 'calm' }))];
    expect(score(list, NOW)!.rules).toBe(12.5);
  });

  it('recordStreak: 칩 두 줄을 다 채운 거래일이 연달아 며칠', () => {
    expect(recordStreak([])).toBe(0);
    expect(recordStreak([tr(1)])).toBe(0);
    // 11/11, 11/9, 11/6 (거래 없는 날은 끊지 않음)
    expect(recordStreak([tr(1, NOW, full), tr(-1, NOW - 2 * D, full), tr(1, NOW - 5 * D, full)])).toBe(3);
    // 가운데 날 한 거래에 mood 없음 → 최근 날만
    expect(recordStreak([tr(1, NOW, full), tr(1, NOW - 2 * D, full), tr(1, NOW - 2 * D, { closeRule: 'kept' }), tr(1, NOW - 5 * D, full)])).toBe(1);
  });

  it('weakestSpot: 5개 이상 묶음 중 합계가 가장 낮은 마이너스', () => {
    const london = Date.UTC(2026, 10, 10, 8, 0);
    const asia = Date.UTC(2026, 10, 10, 1, 0);
    const shorts = Array.from({ length: 5 }, () => tr(1, london + H, { side: 'SHORT', entry: 100, sl: 102, exit: 101.2, openedAt: london, setup: `s${seq}` }));
    const longs = Array.from({ length: 5 }, () => tr(0.4, asia + H, { openedAt: asia, setup: `s${seq}` }));
    const w = weakestSpot([...shorts, ...longs])!;
    expect(w.label).toBe('런던 · 숏');
    expect(w.r).toBeCloseTo(-3, 6);
    expect(weakestSpot([...shorts.slice(0, 4), ...longs.slice(0, 4)])).toBeNull();
    expect(weakestSpot(longs)).toBeNull();
  });

  it('weakestSpot: 셋업 묶음이 더 낮으면 셋업', () => {
    const asia = Date.UTC(2026, 10, 10, 1, 0);
    const a = Array.from({ length: 5 }, () => tr(-1, asia + H, { openedAt: asia, setup: '돌파' }));
    const b = Array.from({ length: 5 }, () => tr(0.5, asia + H, { openedAt: asia, setup: '눌림' }));
    // 아시아·롱 합계 −2.5, 셋업 돌파 −5
    expect(weakestSpot([...a, ...b])).toEqual({ label: '셋업: 돌파', r: -5 });
  });

  it('누적 R · 최대 낙폭 · 연속 승패 · 보유 시간', () => {
    const seqOf = (rs: number[]) => rs.map((r, i) => tr(r, NOW - (rs.length - i) * H));
    expect(cumulativeR(seqOf([1, -1, 2]))).toEqual([1, 0, 2]);
    expect(maxDrawdownR(seqOf([2, -1, -1, 3]))).toBe(2);
    expect(maxDrawdownR([])).toBe(0);
    expect(maxStreaks(seqOf([1, 1, -1, -1, -1, 1]))).toEqual({ win: 2, loss: 3 });
    expect(maxStreaks(seqOf([1, 0, 1]))).toEqual({ win: 1, loss: 0 });
    expect(avgHoldMs([tr(1, NOW, { openedAt: NOW - H }), tr(1, NOW, { openedAt: NOW - 3 * H })])).toBe(2 * H);
    expect(avgHoldMs([tr(null)])).toBeNull();
  });

  it('monthlyRows: 최근 달 먼저', () => {
    const rows = monthlyRows([tr(1, Date.UTC(2026, 9, 10)), tr(-1, Date.UTC(2026, 9, 11)), tr(2, NOW)]);
    expect(rows.map((r) => r.key)).toEqual(['2026-11', '2026-10']);
    expect(rows[1]).toEqual({ key: '2026-10', trades: 2, winRate: 0.5, totalR: 0 });
  });

  it('weekSummary: 한국 시간 일요일 23:59는 그 주, 월요일 00:00은 다음 주', () => {
    const mon = periodStart(NOW, 'week'); // 11/9(월) 00:00 KST
    const list = [tr(1, mon - 60_000, full), tr(-1, mon), tr(2, mon + D, { closeRule: 'earlyExit' })];
    expect(weekSummary(list, mon - 7 * D)).toEqual({ trades: 1, winRate: 1, totalR: 1, kept: 1 });
    expect(weekSummary(list, mon)).toEqual({ trades: 2, winRate: 0.5, totalR: 1, kept: 1 });
  });

  it('pendingReviewWeek · currentFix', () => {
    const mon = periodStart(NOW, 'week');
    const last = mon - 7 * D;
    const j = emptyJournal();
    expect(pendingReviewWeek(j, NOW)).toBeNull();
    j.trades.push(tr(1, last + D));
    expect(pendingReviewWeek(j, NOW)).toBe(last);
    expect(currentFix(j, NOW)).toBeNull();
    j.reviews = [{ weekStart: last, pattern: '', fix: '손절 옮기지 않기', writtenAt: NOW }];
    expect(pendingReviewWeek(j, NOW)).toBeNull();
    expect(currentFix(j, NOW)).toBe('손절 옮기지 않기');
    j.reviews = [{ weekStart: last - 7 * D, pattern: '', fix: '옛날 것', writtenAt: NOW }];
    expect(currentFix(j, NOW)).toBeNull();
  });
});
