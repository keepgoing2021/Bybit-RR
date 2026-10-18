import { describe, expect, it } from 'vitest';
import { lastSma, MA_LINES, sma } from '../../src/core/ma';
import type { Candle } from '../../src/core/types';

const bars = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i * 60_000, open: close, high: close, low: close, close, volume: 0, confirmed: true }));

describe('sma', () => {
  it('averages the last N closes and starts once N bars exist', () => {
    expect(sma(bars([1, 2, 3, 4, 5]), 3)).toEqual([
      { time: 2 * 60_000, value: 2 },
      { time: 3 * 60_000, value: 3 },
      { time: 4 * 60_000, value: 4 },
    ]);
  });

  it('has no points when there are fewer bars than the period', () => {
    expect(sma(bars([1, 2]), 3)).toEqual([]);
  });

  it('stays exact over long series (no drift from the running sum)', () => {
    const closes = Array.from({ length: 5000 }, (_, i) => 60_000 + Math.sin(i) * 1234.5678);
    const out = sma(bars(closes), 100);
    const tail = closes.slice(-100).reduce((a, b) => a + b, 0) / 100;
    expect(out.at(-1)!.value).toBeCloseTo(tail, 8);
  });
});

describe('lastSma', () => {
  it('is the newest point, including the bar still in progress', () => {
    const c = bars([1, 2, 3, 10]);
    c[3] = { ...c[3], confirmed: false };
    expect(lastSma(c, 2)).toEqual({ time: 3 * 60_000, value: 6.5 });
    expect(lastSma(c, 5)).toBeNull();
  });
});

describe('MA_LINES', () => {
  it('is MA20 and MA100 with different colors', () => {
    expect(MA_LINES.map((m) => m.period)).toEqual([20, 100]);
    expect(new Set(MA_LINES.map((m) => m.color)).size).toBe(2);
  });
});
