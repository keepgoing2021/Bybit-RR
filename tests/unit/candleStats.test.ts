import { describe, expect, it } from 'vitest';
import { candleStats, legendIndex } from '../../src/core/candleStats';
import type { Candle } from '../../src/core/types';

const c = (open: number, high: number, low: number, close: number, i: number): Candle => ({
  time: i * 60_000, open, high, low, close, volume: 0, confirmed: true,
});
const bars = [c(100, 101, 99, 100, 0), c(100, 104, 98, 98.96, 1), c(99, 100, 97.5, 99.5, 2)];

describe('candleStats', () => {
  it('change is against the previous close, like the TradingView/Bybit legend', () => {
    const s = candleStats(bars, 1)!;
    expect(s).toMatchObject({ open: 100, high: 104, low: 98, close: 98.96, up: false });
    expect(s.change).toBeCloseTo(-1.04, 9);
    expect(s.changePct).toBeCloseTo(-1.04, 9);
  });

  it('amplitude is (high − low) ÷ previous close', () => {
    expect(candleStats(bars, 1)!.amplitudePct).toBeCloseTo(6, 9);
    expect(candleStats(bars, 2)!.amplitudePct).toBeCloseTo((2.5 / 98.96) * 100, 9);
  });

  it('the first candle has no previous close, so it uses its own open', () => {
    const s = candleStats([c(100, 102, 99, 101, 0)], 0)!;
    expect(s.change).toBe(1);
    expect(s.changePct).toBe(1);
    expect(s.amplitudePct).toBe(3);
  });

  it('out of range is null', () => {
    expect(candleStats(bars, 3)).toBeNull();
    expect(candleStats([], 0)).toBeNull();
  });
});

describe('legendIndex', () => {
  it('a hovered candle shows that candle; right of the last candle or off the chart shows the latest', () => {
    expect(legendIndex(1.2, 3)).toBe(1);
    expect(legendIndex(2.6, 3)).toBe(2); // 마지막 봉의 오른쪽 절반
    expect(legendIndex(7, 3)).toBe(2); // 캔들 오른쪽 빈 곳
    expect(legendIndex(null, 3)).toBe(2); // 차트 밖
    expect(legendIndex(-3, 3)).toBe(0);
    expect(legendIndex(1, 0)).toBeNull();
  });
});
