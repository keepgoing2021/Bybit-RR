import { describe, expect, it } from 'vitest';
import { baseName, FLOW_WINDOW_MIN, FlowBook, gainScore } from '../../src/core/flow';

const M = 60_000;
const T0 = 1_760_000_000_000 - (1_760_000_000_000 % M); // 분 경계

describe('FlowBook (15-minute turnover; gainers among the top-turnover symbols)', () => {
  it('sums the current minute and the 14 before it; change = last close vs the first open in the window', () => {
    expect(FLOW_WINDOW_MIN).toBe(15);
    const f = new FlowBook();
    // A: 16분 전 봉은 창 밖, 최근 15분은 100 → 130, 거래대금 합 15 × 20만
    f.update('AUSDT', { start: T0 - 15 * M, open: 50, close: 100, turnover: 9e9 }, T0 - 15 * M);
    for (let k = 14; k >= 0; k--) f.update('AUSDT', { start: T0 - k * M, open: 100 + (14 - k) * 2, close: 102 + (14 - k) * 2, turnover: 200_000 }, T0);
    // B: 거래대금은 더 크지만 내림
    f.update('BUSDT', { start: T0, open: 10, close: 9, turnover: 5_000_000 }, T0);
    const r = f.rank(T0 + 30_000);
    expect(r.volume.map((x) => x.symbol)).toEqual(['BUSDT', 'AUSDT']);
    expect(r.volume[1].turnover).toBe(3_000_000);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['AUSDT']); // 내린 B는 상승률에 없음
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
    expect(r.gainers[0].changePct).toBeCloseTo(5, 9);
    for (let k = 1; k <= 20; k++) f.update('AUSDT', { start: T0 + k * M, open: 100, close: 100, turnover: 1 }, T0 + k * M);
    r = f.rank(T0 + 20 * M + 1_000);
    expect(r.volume[0].turnover).toBe(15); // 최근 15분봉만
  });

  it('gainers rank by change × 15-minute turnover (money behind the rise); tiny rises are dropped; top N', () => {
    const f = new FlowBook();
    // BIG: +1% × 2억 = 2억점, MID: +4% × 3천만 = 1.2억점, SMALL: +10% × 500만 = 5천만점
    f.update('BIGUSDT', { start: T0, open: 100, close: 101, turnover: 200_000_000 }, T0);
    f.update('MIDUSDT', { start: T0, open: 100, close: 104, turnover: 30_000_000 }, T0);
    f.update('SMALLUSDT', { start: T0, open: 100, close: 110, turnover: 5_000_000 }, T0);
    // 얇은 종목은 +50%여도 거래대금이 작아 뒤로 밀림 (50 × 1천 = 5만점)
    f.update('THINUSDT', { start: T0, open: 1, close: 1.5, turnover: 1_000 }, T0);
    // 내린 종목·+0.00%로 보일 만큼 작은 오름(0.004%)은 빠짐 — 거래대금 1위라도
    f.update('DOWNUSDT', { start: T0, open: 100, close: 95, turnover: 300_000_000 }, T0);
    f.update('FLATUSDT', { start: T0, open: 100_000, close: 100_004, turnover: 500_000_000 }, T0);
    let r = f.rank(T0 + 1_000);
    expect(r.volume.map((x) => x.symbol)).toEqual(['FLATUSDT', 'DOWNUSDT', 'BIGUSDT']);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['BIGUSDT', 'MIDUSDT', 'SMALLUSDT']);
    expect(gainScore(r.gainers[0])).toBeCloseTo(200_000_000, 0);
    r = f.rank(T0 + 1_000, 5);
    expect(r.gainers.map((x) => x.symbol)).toEqual(['BIGUSDT', 'MIDUSDT', 'SMALLUSDT', 'THINUSDT']);
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
    expect(r.gainers[0].changePct).toBeCloseTo(3, 9);
  });

  it('baseName strips USDT', () => {
    expect(baseName('BTCUSDT')).toBe('BTC');
    expect(baseName('1000PEPEUSDT')).toBe('1000PEPE');
    expect(baseName('DEMO-BTC')).toBe('DEMO-BTC');
  });
});
