import { describe, expect, it } from 'vitest';
import { emptyJournal, JOURNAL_KEY, parseJournal, type Trade } from '../../src/core/journal';
import { MIN, resolveByCandles, trackStart, type MiniCandle } from '../../src/core/virtualTrack';
import { fetchKlineRange, type FetchLike } from '../../src/data/bybit/klineRange';
import { trackOpenTrades } from '../../src/data/virtualTracker';

const T0 = Date.UTC(2026, 10, 11, 0, 0, 30); // 00:00:30
let seq = 0;
const trade = (p: Partial<Trade> = {}): Trade => ({
  id: `v${++seq}`, symbol: 'BTCUSDT', side: 'LONG', entry: 100, sl: 98, tp: 104, qty: null, riskUsdt: 10, riskPct: 1,
  openedAt: T0, closedAt: null, exit: null, setup: '', quality: 'rule', reason: '', rules: [], feeRate: 0.00055, ...p,
});
const c = (i: number, low: number, high: number): MiniCandle => ({ time: Date.UTC(2026, 10, 11, 0, i), low, high });

describe('가상 거래 판정', () => {
  it('trackStart: 진입한 분은 건너뛰고 다음 분부터', () => {
    expect(trackStart(trade())).toBe(Date.UTC(2026, 10, 11, 0, 1));
    expect(trackStart(trade({ openedAt: Date.UTC(2026, 10, 11, 0, 5) }))).toBe(Date.UTC(2026, 10, 11, 0, 6));
    expect(trackStart(trade({ trackedTo: Date.UTC(2026, 10, 11, 3, 0) }))).toBe(Date.UTC(2026, 10, 11, 3, 0));
  });

  it('롱: 저가가 손절에 닿으면 손절, 고가가 목표에 닿으면 목표', () => {
    expect(resolveByCandles(trade(), [c(1, 99, 101), c(2, 98, 100)])).toEqual({ hit: 'sl', exit: 98, closedAt: c(2, 0, 0).time + MIN });
    expect(resolveByCandles(trade(), [c(1, 99, 101), c(2, 100, 104.5)])).toEqual({ hit: 'tp', exit: 104, closedAt: c(2, 0, 0).time + MIN });
    expect(resolveByCandles(trade(), [c(1, 98.01, 103.99)])).toBeNull();
  });

  it('숏: 반대', () => {
    const s = trade({ side: 'SHORT', sl: 102, tp: 96 });
    expect(resolveByCandles(s, [c(1, 99, 102)])?.hit).toBe('sl');
    expect(resolveByCandles(s, [c(1, 96, 101)])).toEqual({ hit: 'tp', exit: 96, closedAt: c(1, 0, 0).time + MIN });
  });

  it('한 캔들에서 둘 다 닿으면 손절 (좋게 봐주지 않는다)', () => {
    expect(resolveByCandles(trade(), [c(1, 97, 105)])?.hit).toBe('sl');
  });

  it('목표가 없으면 손절만 본다. 진입 전·진입한 분의 캔들은 무시', () => {
    expect(resolveByCandles(trade({ tp: null }), [c(1, 99, 500)])).toBeNull();
    expect(resolveByCandles(trade(), [c(0, 90, 110), c(1, 99, 101)])).toBeNull();
  });

  it('이상한 캔들(NaN)은 건너뛴다', () => {
    expect(resolveByCandles(trade(), [{ time: c(1, 0, 0).time, low: NaN, high: NaN }, c(2, 97, 99)])?.hit).toBe('sl');
  });
});

/** 가짜 Bybit: 분마다 캔들 하나. hit(분 시각) → [low, high] */
function fakeBybit(range: (t: number) => [number, number], log: string[] = []): FetchLike {
  return async (url) => {
    log.push(url);
    const u = new URL(url);
    const start = Number(u.searchParams.get('start'));
    const end = Number(u.searchParams.get('end'));
    const list: string[][] = [];
    for (let t = end - (end % MIN); t >= start; t -= MIN) {
      const [lo, hi] = range(t);
      list.push([String(t), '100', String(hi), String(lo), '100', '1', '1']);
    }
    return { ok: true, status: 200, json: async () => ({ retCode: 0, result: { list } }) };
  };
}
const mem = (j = emptyJournal()) => {
  const m = new Map<string, string>([[JOURNAL_KEY, JSON.stringify(j)]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('1분 캔들 받기', () => {
  it('마감된 캔들만, 오래된 것부터. 1000개씩 나눠 받는다', async () => {
    const log: string[] = [];
    const start = Date.UTC(2026, 10, 11, 0, 1);
    const now = start + 1500 * MIN + 20_000;
    const got = await fetchKlineRange(fakeBybit(() => [99, 101], log), ['https://x'], 'BTCUSDT', start, now, 5);
    expect(got).toHaveLength(1500);
    expect(got[0].time).toBe(start);
    expect(got[got.length - 1].time).toBe(start + 1499 * MIN);
    expect(log).toHaveLength(2);
    expect(log[0]).toContain('symbol=BTCUSDT');
    expect(log[0]).toContain('interval=1');
  });

  it('쪽 수 한도까지만 받는다. 종목 이름이 이상하면 거절', async () => {
    const start = Date.UTC(2026, 10, 1);
    expect(await fetchKlineRange(fakeBybit(() => [99, 101]), ['https://x'], 'BTCUSDT', start, start + 9000 * MIN, 2)).toHaveLength(2000);
    await expect(fetchKlineRange(fakeBybit(() => [99, 101]), ['https://x'], 'BTC&x=1', start, start + MIN * 5, 2)).rejects.toThrow();
  });

  it('Bybit 오류 코드면 실패', async () => {
    const bad: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ retCode: 10001, retMsg: 'bad' }) });
    await expect(fetchKlineRange(bad, ['https://x'], 'BTCUSDT', 0, 10 * MIN, 1)).rejects.toThrow('10001');
  });
});

describe('열린 거래 추적', () => {
  const hitAt = Date.UTC(2026, 10, 11, 0, 7);
  const now = Date.UTC(2026, 10, 11, 0, 30, 10);

  it('손절에 닿은 거래를 자동 청산하고, 안 닿은 거래는 어디까지 봤는지만 적는다', async () => {
    const j = emptyJournal();
    j.trades.push(trade({ id: 'a' }), trade({ id: 'b', symbol: 'ETHUSDT' }), trade({ id: 'done', exit: 104, closedAt: T0 + MIN }));
    const st = mem(j);
    const fetchImpl: FetchLike = (url) => fakeBybit((t) => (url.includes('BTCUSDT') && t === hitAt ? [97.5, 100] : [99, 101]))(url);
    const closed = await trackOpenTrades({ storage: st, fetchImpl, bases: ['https://x'], now: () => now });
    expect(closed.map((t) => t.id)).toEqual(['a']);
    const saved = parseJournal(st.getItem(JOURNAL_KEY));
    const a = saved.trades.find((t) => t.id === 'a')!;
    expect(a.exit).toBe(98);
    expect(a.closedAt).toBe(hitAt + MIN);
    expect(a.auto).toBe('sl');
    const b = saved.trades.find((t) => t.id === 'b')!;
    expect(b.exit).toBeNull();
    expect(b.trackedTo).toBe(Date.UTC(2026, 10, 11, 0, 30));
    expect(saved.trades.find((t) => t.id === 'done')!.exit).toBe(104);
  });

  it('받는 사이 사용자가 직접 청산했으면 건드리지 않는다. 통신 실패는 조용히 넘어간다', async () => {
    const j = emptyJournal();
    j.trades.push(trade({ id: 'a' }));
    const st = mem(j);
    const fetchImpl: FetchLike = async (url) => {
      const mine = parseJournal(st.getItem(JOURNAL_KEY));
      mine.trades[0].exit = 101;
      mine.trades[0].closedAt = now;
      st.setItem(JOURNAL_KEY, JSON.stringify(mine));
      return fakeBybit(() => [97, 100])(url);
    };
    expect(await trackOpenTrades({ storage: st, fetchImpl, bases: ['https://x'], now: () => now })).toEqual([]);
    expect(parseJournal(st.getItem(JOURNAL_KEY)).trades[0].exit).toBe(101);
    const st2 = mem(j);
    const down: FetchLike = async () => { throw new Error('offline'); };
    expect(await trackOpenTrades({ storage: st2, fetchImpl: down, bases: ['https://x'], now: () => now })).toEqual([]);
    expect(parseJournal(st2.getItem(JOURNAL_KEY)).trades[0].exit).toBeNull();
  });

  it('저장 형식: auto·trackedTo는 올바른 값만 남는다', () => {
    const raw = (x: object) => JSON.stringify({ version: 1, trades: [{ ...trade(), ...x }], settings: {} });
    const ok = parseJournal(raw({ auto: 'tp', trackedTo: 123 })).trades[0];
    expect(ok.auto).toBe('tp');
    expect(ok.trackedTo).toBe(123);
    const bad = parseJournal(raw({ auto: 'x', trackedTo: 'y' })).trades[0];
    expect('auto' in bad).toBe(false);
    expect('trackedTo' in bad).toBe(false);
    // 종목 이름: 영문 대문자·숫자·하이픈만 (만기 선물·데모 종목)
    expect(parseJournal(raw({ symbol: 'DEMO-BTC' })).trades).toHaveLength(1);
    expect(parseJournal(raw({ symbol: 'BTC<b>' })).trades).toHaveLength(0);
    expect(parseJournal(raw({ symbol: '-BTC' })).trades).toHaveLength(0);
  });
});
