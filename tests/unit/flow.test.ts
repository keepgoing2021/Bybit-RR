import { describe, expect, it } from 'vitest';
import { baseName, FLOW_WINDOW_MIN, FlowBook } from '../../src/core/flow';

const M = 60_000;
const T0 = 1_760_000_000_000 - (1_760_000_000_000 % M); // 분 경계

describe('FlowBook (15-minute turnover; gainers = rising volume spikes)', () => {
  it('sums the current minute and the 14 before it; change = last close vs the first open in the window', () => {
    expect(FLOW_WINDOW_MIN).toBe(15);
    const f = new FlowBook();
    // A: 16분 전 봉은 창 밖, 최근 15분은 100 → 130, 거래대금 합 15 × 20만
    f.update('AUSDT', { start: T0 - 15 * M, open: 50, close: 100, turnover: 9e9 }, T0 - 15 * M);
    for (let k = 14; k >= 0; k--) f.update('AUSDT', { start: T0 - k * M, open: 100 + (14 - k) * 2, close: 102 + (14 - k) * 2, turnover: 200_000 }, T0);
    // B: 거래대금은 더 크지만 내림
    f.update('BUSDT', { start: T0, open: 10, close: 9, turnover: 5_000_000 }, T0);
    // 평소 15분 100만(24시간 9,600만) → A는 300만이라 3배 (상승률 줄 후보)
    f.setUsual([{ symbol: 'AUSDT', turnover24h: 96_000_000 }, { symbol: 'BUSDT', turnover24h: 96_000_000 }]);
    const r = f.rank(T0 + 30_000);
    expect(r.volume.map((x) => x.symbol)).toEqual(['BUSDT', 'AUSDT']);
    expect(r.volume[1].turnover).toBe(3_000_000);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['AUSDT']); // 내린 B는 상승률에 없음 (5배여도)
    expect(r.gainers[0].changePct).toBeCloseTo(30, 9); // 100 → 130
  });

  it('the in-progress bar is updated in place; only the last 16 bars are kept', () => {
    const f = new FlowBook();
    f.update('AUSDT', { start: T0, open: 100, close: 101, turnover: 60_000 }, T0);
    f.update('AUSDT', { start: T0, open: 100, close: 105, turnover: 90_000 }, T0 + 5_000);
    expect(f.has('AUSDT', T0)).toBe(true);
    expect(f.has('AUSDT', T0 + M)).toBe(false);
    let r = f.rank(T0 + 10_000);
    expect(r.volume[0].turnover).toBe(90_000);
    expect(r.volume[0].changePct).toBeCloseTo(5, 9);
    for (let k = 1; k <= 20; k++) f.update('AUSDT', { start: T0 + k * M, open: 100, close: 100, turnover: 1 }, T0 + k * M);
    r = f.rank(T0 + 20 * M + 1_000);
    expect(r.volume[0].turnover).toBe(15); // 최근 15분봉만
  });

  it('gainers: only volume spikes (≥2× usual, ≥100K USDT), ranked by change; tiny rises dropped; top N', () => {
    const f = new FlowBook();
    const now = T0 + 15 * M - 1; // 15번째 봉이 끝나기 직전 (모은 시간 ≈ 15분)
    const bar = (symbol: string, open: number, close: number, turnover15: number) => {
      // 15분에 고르게 나눠 넣는다: 첫 봉 시가 → 마지막 봉 종가
      for (let k = 0; k < 15; k++) f.update(symbol, { start: T0 + k * M, open: k === 0 ? open : close, close, turnover: turnover15 / 15 }, T0 + k * M);
    };
    // 평소 15분 거래대금 = 24시간 ÷ 96
    const day = (usual15: number) => usual15 * 96;
    bar('BIGUSDT', 100, 100.5, 80_000_000); // 평소 4천만 → 2배, +0.5%
    bar('HOTUSDT', 100, 106, 3_000_000); // 평소 50만 → 6배, +6%
    bar('MIDUSDT', 100, 103, 1_000_000); // 평소 40만 → 2.5배, +3%
    bar('CALMUSDT', 100, 110, 5_000_000); // 평소 1천만 → 0.5배: +10%여도 거래가 평소보다 적어 빠짐
    bar('THINUSDT', 1, 1.5, 50_000); // 평소 1천 → 50배지만 15분 5만 USDT라 빠짐
    bar('DOWNUSDT', 100, 95, 9_000_000); // 평소 100만 → 9배지만 내림
    bar('NOBASEUSDT', 100, 120, 9_000_000); // 24시간 거래대금을 모름 → 빠짐
    f.setUsual([
      { symbol: 'BIGUSDT', turnover24h: day(40_000_000) },
      { symbol: 'HOTUSDT', turnover24h: day(500_000) },
      { symbol: 'MIDUSDT', turnover24h: day(400_000) },
      { symbol: 'CALMUSDT', turnover24h: day(10_000_000) },
      { symbol: 'THINUSDT', turnover24h: day(1_000) },
      { symbol: 'DOWNUSDT', turnover24h: day(1_000_000) },
      { symbol: 'NOBASEUSDT', turnover24h: 0 },
    ]);
    let r = f.rank(now);
    expect(r.volume.map((x) => x.symbol)).toEqual(['BIGUSDT', 'DOWNUSDT', 'NOBASEUSDT']);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['HOTUSDT', 'MIDUSDT', 'BIGUSDT']);
    expect(r.gainers[0].spike).toBeCloseTo(6, 3);
    expect(r.gainers[2].spike).toBeCloseTo(2, 3);
    expect(r.volume.find((x) => x.symbol === 'NOBASEUSDT')?.spike).toBeUndefined();
    r = f.rank(now, 2);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['HOTUSDT', 'MIDUSDT']);
    // 24시간 값이 바뀌면 바로 반영 (MID 평소가 60만이 되면 1.67배 → 빠짐)
    f.setUsual([{ symbol: 'MIDUSDT', turnover24h: day(600_000) }]);
    expect(f.rank(now).gainers.map((x) => x.symbol)).toEqual(['HOTUSDT', 'BIGUSDT']);
  });

  it('spike compares only the minutes collected so far (just after connecting)', () => {
    const f = new FlowBook();
    // 연결 직후 2분치: 2분에 40만 USDT, 평소 15분 150만(= 1분 10만) → 2분 평소 20만 → 2배
    f.update('NEWUSDT', { start: T0, open: 100, close: 102, turnover: 200_000 }, T0);
    f.update('NEWUSDT', { start: T0 + M, open: 102, close: 104, turnover: 200_000 }, T0 + M);
    f.setUsual([{ symbol: 'NEWUSDT', turnover24h: 1_500_000 * 96 }]);
    const r = f.rank(T0 + 2 * M);
    expect(r.gainers[0]?.spike).toBeCloseTo(2, 6);
    // 첫 1분의 처음 몇 초는 1분으로 친다 (몇 초치로 나눠 부풀지 않게)
    const g = new FlowBook();
    g.update('NEWUSDT', { start: T0, open: 100, close: 101, turnover: 100_000 }, T0);
    g.setUsual([{ symbol: 'NEWUSDT', turnover24h: 1_500_000 * 96 }]);
    expect(g.rank(T0 + 5_000).volume[0].spike).toBeCloseTo(1, 6);
    // clear는 평소 값도 지운다
    g.clear();
    g.update('NEWUSDT', { start: T0, open: 100, close: 101, turnover: 100_000 }, T0);
    expect(g.rank(T0 + 5_000).volume[0].spike).toBeUndefined();
  });

  it('coverage: minutes since the earliest bar received, up to 15; ignores bad bars; clear resets', () => {
    const f = new FlowBook();
    expect(f.rank(T0).coverageMin).toBe(0);
    f.update('AUSDT', { start: T0, open: 0, close: 1, turnover: 1 }); // 시가 0은 버림
    expect(f.rank(T0).volume).toEqual([]);
    expect(f.rank(T0).coverageMin).toBe(0);
    f.update('AUSDT', { start: T0, open: 1, close: 1, turnover: 1 }); // 연결 직후: 이번 1분 봉만
    expect(f.rank(T0 + 20_000).coverageMin).toBe(1);
    expect(f.rank(T0 + 2 * M + 5_000).coverageMin).toBe(3);
    expect(f.rank(T0 + 30 * M).coverageMin).toBe(15);
    // 지난 봉을 미리 받아 채우면 바로 15분
    const g = new FlowBook();
    for (let k = 14; k >= 0; k--) g.update('AUSDT', { start: T0 - k * M, open: 1, close: 1, turnover: 1 });
    expect(g.rank(T0 + 1_000).coverageMin).toBe(15);
    f.clear();
    expect(f.rank(T0 + 10 * M).coverageMin).toBe(0);
  });

  it('uses the latest bar start when the browser clock lags the exchange (new minute not dropped)', () => {
    const f = new FlowBook();
    f.update('AUSDT', { start: T0 - 14 * M, open: 100, close: 100, turnover: 100_000 });
    f.update('AUSDT', { start: T0 + M, open: 100, close: 103, turnover: 100_000 }); // 거래소는 이미 다음 분
    const r = f.rank(T0 + 59_000); // 브라우저 시계는 아직 이전 분
    expect(r.volume[0].turnover).toBe(100_000); // 15분 전(T0 − 14분) 봉은 창 밖, 새 분 봉은 포함
    expect(r.volume[0].changePct).toBeCloseTo(3, 9);
  });

  it('baseName strips USDT', () => {
    expect(baseName('BTCUSDT')).toBe('BTC');
    expect(baseName('1000PEPEUSDT')).toBe('1000PEPE');
    expect(baseName('DEMO-BTC')).toBe('DEMO-BTC');
  });
});
