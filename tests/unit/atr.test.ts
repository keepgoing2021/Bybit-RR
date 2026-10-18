import { describe, expect, it } from 'vitest';
import { atrSeries, trueRange } from '../../src/core/atr';
import { fromOhlc, ranged } from './helpers/candles';

describe('trueRange', () => {
  it('is high minus low without a previous candle', () => {
    const [c] = fromOhlc([[10, 15, 12, 13]]);
    expect(trueRange(c)).toBe(3);
  });

  it('uses the previous close when the candle gaps', () => {
    const [prev, c] = fromOhlc([[9, 11, 9, 10], [13, 15, 12, 14]]);
    expect(trueRange(c, prev)).toBe(5);
  });
});

describe('atrSeries', () => {
  it('wilder seeds with the mean of the first period TRs, then smooths', () => {
    const atr = atrSeries(ranged([2, 4, 6, 8]), 3, 'wilder');
    expect(atr[0]).toBeNull();
    expect(atr[1]).toBeNull();
    expect(atr[2]).toBe(4);
    expect(atr[3]).toBeCloseTo(16 / 3, 12);
  });

  it('sma is the plain mean of the last period TRs', () => {
    const atr = atrSeries(ranged([2, 4, 6, 8]), 3, 'sma');
    expect(atr[2]).toBe(4);
    expect(atr[3]).toBe(6);
  });

  it('returns all nulls when there are fewer candles than the period', () => {
    expect(atrSeries(ranged([1, 1]), 3, 'wilder')).toEqual([null, null]);
  });
});
