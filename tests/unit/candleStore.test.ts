import { describe, expect, it } from 'vitest';
import { CandleStore } from '../../src/data/candleStore';
import type { Candle } from '../../src/core/types';

const c = (time: number, close: number, confirmed = true): Candle => ({
  time, open: close, high: close, low: close, close, volume: 1, confirmed,
});

describe('CandleStore', () => {
  it('setAll sorts and removes duplicate times', () => {
    const s = new CandleStore();
    s.setAll([c(3, 3), c(1, 1), c(2, 2), c(2, 2.5)]);
    expect(s.all().map((x) => x.time)).toEqual([1, 2, 3]);
  });

  it('upsert appends newer, updates same time, inserts missing older', () => {
    const s = new CandleStore();
    s.setAll([c(1, 1), c(3, 3)]);
    expect(s.upsert(c(4, 4))).toBe('append');
    expect(s.upsert(c(4, 4.5))).toBe('update');
    expect(s.upsert(c(2, 2))).toBe('insert');
    expect(s.all().map((x) => [x.time, x.close])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4.5]]);
    expect(s.last()?.close).toBe(4.5);
  });

  it('does not overwrite a confirmed candle with an unconfirmed one', () => {
    const s = new CandleStore();
    s.setAll([c(1, 1, true)]);
    s.upsert(c(1, 9, false));
    expect(s.all()[0]).toEqual(c(1, 1, true));
  });

  it('merge fills a gap from backfill and keeps live updates', () => {
    const s = new CandleStore();
    s.setAll([c(1, 1), c(2, 2, false)]);
    s.merge([c(2, 2.2, true), c(3, 3), c(4, 4, false)]);
    expect(s.all().map((x) => [x.time, x.close, x.confirmed])).toEqual([
      [1, 1, true], [2, 2.2, true], [3, 3, true], [4, 4, false],
    ]);
  });
});
