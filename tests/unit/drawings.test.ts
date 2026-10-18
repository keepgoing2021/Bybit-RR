import { describe, expect, it } from 'vitest';
import {
  channelOffset, DRAW_PALETTE, FIB_LEVELS, fibLevels, isColor, mapPoints, POINTS, sanitizeDrawings, setPoint, type Drawing,
} from '../../src/core/drawings';
import { logicalToTime, timeToLogical } from '../../src/core/timeMap';

const M = 60_000;
const times = [0, 1, 2, 3, 4].map((i) => i * M); // 1분봉 5개

describe('timeToLogical / logicalToTime', () => {
  it('bar times map to their index, in-between times to fractions', () => {
    expect(timeToLogical(times, M, 2 * M)).toBe(2);
    expect(timeToLogical(times, M, 2.5 * M)).toBe(2.5);
    expect(logicalToTime(times, M, 3)).toBe(3 * M);
    expect(logicalToTime(times, M, 1.5)).toBe(1.5 * M);
  });

  it('extrapolates past the last bar and before the first (drawings can reach into the future)', () => {
    expect(timeToLogical(times, M, 10 * M)).toBe(10);
    expect(logicalToTime(times, M, 12)).toBe(12 * M);
    expect(timeToLogical(times, M, -2 * M)).toBe(-2);
    expect(logicalToTime(times, M, -1)).toBe(-M);
  });

  it('round-trips', () => {
    for (const l of [-3, 0, 1.25, 4, 7.5]) expect(timeToLogical(times, M, logicalToTime(times, M, l)!)).toBeCloseTo(l, 9);
  });

  it('no candles → null', () => {
    expect(timeToLogical([], M, 0)).toBeNull();
    expect(logicalToTime([], M, 0)).toBeNull();
  });
});

describe('drawings', () => {
  it('points needed per tool', () => {
    expect(POINTS).toEqual({ trend: 2, hline: 1, channel: 3, fib: 2 });
  });

  it('fib retracement like TradingView: 1 at the first point, 0 at the second', () => {
    expect(FIB_LEVELS).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
    const lv = fibLevels({ time: 0, price: 100 }, { time: M, price: 200 });
    expect(lv.find((l) => l.level === 0)!.price).toBe(200);
    expect(lv.find((l) => l.level === 1)!.price).toBe(100);
    expect(lv.find((l) => l.level === 0.618)!.price).toBeCloseTo(138.2, 9);
    expect(lv.find((l) => l.level === 0.5)!.price).toBe(150);
  });

  it('channel: the parallel line goes through the third point', () => {
    // 기준선 0분 100 → 10분 110 (분당 +1). 5분 지점 기준선 가격 105, 셋째 점 99 → 아래로 6
    expect(channelOffset({ time: 0, price: 100 }, { time: 10 * M, price: 110 }, { time: 5 * M, price: 99 })).toBeCloseTo(-6, 9);
    // 세로로 같은 시각이면 그 점 가격 차이
    expect(channelOffset({ time: 0, price: 100 }, { time: 0, price: 110 }, { time: 3 * M, price: 90 })).toBe(-10);
  });

  it('move and edit points without touching the others', () => {
    const d: Drawing = { id: 'a', kind: 'trend', points: [{ time: 0, price: 1 }, { time: M, price: 2 }] };
    expect(setPoint(d, 1, { time: 2 * M, price: 3 }).points).toEqual([{ time: 0, price: 1 }, { time: 2 * M, price: 3 }]);
    expect(mapPoints(d, (p) => ({ time: p.time + M, price: p.price + 10 })).points).toEqual([
      { time: M, price: 11 }, { time: 2 * M, price: 12 },
    ]);
    expect(d.points[0]).toEqual({ time: 0, price: 1 }); // 원본은 그대로
  });

  it('keeps a valid color and drops a bad one', () => {
    const colored = { id: 'c', kind: 'hline', points: [{ time: 1, price: 2 }], color: '#ff00aa' };
    const bad = { id: 'd', kind: 'hline', points: [{ time: 1, price: 2 }], color: 'red; x' };
    expect(sanitizeDrawings({ X: [colored, bad] })).toEqual({ X: [colored, { id: 'd', kind: 'hline', points: [{ time: 1, price: 2 }] }] });
    expect(isColor('#A1b2C3')).toBe(true);
    expect(isColor('#abc')).toBe(false);
    expect(DRAW_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(DRAW_PALETTE.every(isColor)).toBe(true);
  });

  it('sanitizes saved drawings per symbol', () => {
    const good: Drawing = { id: 'x', kind: 'hline', points: [{ time: 5, price: 100 }] };
    const r = sanitizeDrawings({
      BTCUSDT: [good, { id: 'y', kind: 'trend', points: [{ time: 1, price: 2 }] }, { id: 'z', kind: 'circle', points: [] }],
      ETHUSDT: 'nope',
    });
    expect(r).toEqual({ BTCUSDT: [good] });
    expect(sanitizeDrawings(null)).toEqual({});
  });
});
