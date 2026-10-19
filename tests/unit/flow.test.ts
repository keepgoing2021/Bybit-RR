import { describe, expect, it } from 'vitest';
import { baseName, FLOW_MIN_TURNOVER, FlowBook } from '../../src/core/flow';

const M = 60_000;
const T0 = 1_760_000_000_000 - (1_760_000_000_000 % M); // 분 경계

describe('FlowBook (5-minute turnover and gainers from 1-minute bars)', () => {
  it('sums the current minute and the 4 before it; change = last close vs the first open in the window', () => {
    const f = new FlowBook();
    // A: 6분 전 봉은 창 밖, 최근 5분은 100 → 110, 거래대금 합 5 × 20만
    f.update('AUSDT', { start: T0 - 5 * M, open: 50, close: 100, turnover: 9e9 }, T0 - 5 * M);
    for (let k = 4; k >= 0; k--) f.update('AUSDT', { start: T0 - k * M, open: 100 + (4 - k) * 2, close: 102 + (4 - k) * 2, turnover: 200_000 }, T0);
    // B: 거래대금은 더 크지만 내림
    f.update('BUSDT', { start: T0, open: 10, close: 9, turnover: 5_000_000 }, T0);
    const r = f.rank(T0 + 30_000);
    expect(r.volume.map((x) => x.symbol)).toEqual(['BUSDT', 'AUSDT']);
    expect(r.volume[1].turnover).toBe(1_000_000);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['AUSDT']); // 내린 B는 상승률에 없음
    expect(r.gainers[0].changePct).toBeCloseTo(10, 9); // 100 → 110
  });

  it('the in-progress bar is updated in place; only the last 6 bars are kept', () => {
    const f = new FlowBook();
    f.update('AUSDT', { start: T0, open: 100, close: 101, turnover: 60_000 }, T0);
    f.update('AUSDT', { start: T0, open: 100, close: 105, turnover: 90_000 }, T0 + 5_000);
    let r = f.rank(T0 + 10_000);
    expect(r.volume[0].turnover).toBe(90_000);
    expect(r.gainers[0].changePct).toBeCloseTo(5, 9);
    for (let k = 1; k <= 8; k++) f.update('AUSDT', { start: T0 + k * M, open: 100, close: 100, turnover: 1 }, T0 + k * M);
    r = f.rank(T0 + 8 * M + 1_000);
    expect(r.volume[0].turnover).toBe(5); // 최근 5분봉만
  });

  it('gainers need at least the minimum 5-minute turnover; top N; ties broken by turnover', () => {
    const f = new FlowBook();
    f.update('THINUSDT', { start: T0, open: 1, close: 2, turnover: FLOW_MIN_TURNOVER - 1 }, T0);
    f.update('AUSDT', { start: T0, open: 10, close: 11, turnover: 100_000 }, T0);
    f.update('BUSDT', { start: T0, open: 10, close: 11, turnover: 200_000 }, T0);
    f.update('CUSDT', { start: T0, open: 10, close: 10.5, turnover: 300_000 }, T0);
    f.update('DUSDT', { start: T0, open: 10, close: 10.2, turnover: 400_000 }, T0);
    // +0.00%로 보일 만큼 작은 오름(0.004%)은 상승률에 없음, 0.005%(+0.01%로 보임)부터
    f.update('FLATUSDT', { start: T0, open: 100_000, close: 100_004, turnover: 900_000 }, T0);
    f.update('TINYUSDT', { start: T0, open: 100_000, close: 100_005, turnover: 900_000 }, T0);
    let r = f.rank(T0 + 1_000, 10);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['BUSDT', 'AUSDT', 'CUSDT', 'DUSDT', 'TINYUSDT']);
    r = f.rank(T0 + 1_000);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['BUSDT', 'AUSDT', 'CUSDT']);
    expect(r.volume.map((x) => x.symbol)).toEqual(['FLATUSDT', 'TINYUSDT', 'DUSDT']);
  });

  it('coverage: minutes since the earliest bar received, up to 5; ignores bad bars; clear resets', () => {
    const f = new FlowBook();
    expect(f.rank(T0).coverageMin).toBe(0);
    f.update('AUSDT', { start: T0, open: 0, close: 1, turnover: 1 }); // 시가 0은 버림
    expect(f.rank(T0).volume).toEqual([]);
    expect(f.rank(T0).coverageMin).toBe(0);
    f.update('AUSDT', { start: T0, open: 1, close: 1, turnover: 1 }); // 연결 직후: 이번 1분 봉만
    expect(f.rank(T0 + 20_000).coverageMin).toBe(1);
    expect(f.rank(T0 + 2 * M + 5_000).coverageMin).toBe(3);
    expect(f.rank(T0 + 9 * M).coverageMin).toBe(5);
    // 지난 봉까지 같이 받으면 바로 5분
    const g = new FlowBook();
    for (let k = 4; k >= 0; k--) g.update('AUSDT', { start: T0 - k * M, open: 1, close: 1, turnover: 1 });
    expect(g.rank(T0 + 1_000).coverageMin).toBe(5);
    f.clear();
    expect(f.rank(T0 + 10 * M).coverageMin).toBe(0);
  });

  it('uses the latest bar start when the browser clock lags the exchange (new minute not dropped)', () => {
    const f = new FlowBook();
    f.update('AUSDT', { start: T0 - 4 * M, open: 100, close: 100, turnover: 100_000 });
    f.update('AUSDT', { start: T0 + M, open: 100, close: 103, turnover: 100_000 }); // 거래소는 이미 다음 분
    const r = f.rank(T0 + 59_000); // 브라우저 시계는 아직 이전 분
    expect(r.volume[0].turnover).toBe(100_000); // 5분 전(T0 − 4분) 봉은 창 밖, 새 분 봉은 포함
    expect(r.gainers[0].changePct).toBeCloseTo(3, 9);
  });

  it('baseName strips USDT', () => {
    expect(baseName('BTCUSDT')).toBe('BTC');
    expect(baseName('1000PEPEUSDT')).toBe('1000PEPE');
    expect(baseName('DEMO-BTC')).toBe('DEMO-BTC');
  });
});
