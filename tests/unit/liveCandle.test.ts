import { describe, expect, it } from 'vitest';
import { applyTrade } from '../../src/core/liveCandle';
import type { Candle, PriceTick } from '../../src/core/types';

const M = 60_000;
const live: Candle = { time: 10 * M, open: 100, high: 101, low: 99, close: 100.5, volume: 3, confirmed: false };
const trade = (price: number, time: number): PriceTick => ({ price, time, source: 'trade' });

describe('applyTrade', () => {
  it('moves the live candle close and stretches high and low', () => {
    expect(applyTrade(live, trade(102, 10 * M + 30_000), '1')).toEqual({
      kind: 'update',
      candle: { ...live, close: 102, high: 102 },
    });
    expect(applyTrade(live, trade(98.5, 10 * M + 59_999), '1')?.candle).toMatchObject({ close: 98.5, low: 98.5, high: 101 });
  });

  it('keeps the candle unconfirmed so analysis still ignores it', () => {
    expect(applyTrade(live, trade(100, 10 * M + 1), '1')?.candle.confirmed).toBe(false);
  });

  it('never changes a confirmed candle', () => {
    expect(applyTrade({ ...live, confirmed: true }, trade(150, 10 * M + 5), '1')).toBeNull();
  });

  it('starts a provisional candle when the trade opens a new period', () => {
    expect(applyTrade(live, trade(103, 11 * M + 2_000), '1')).toEqual({
      kind: 'append',
      candle: { time: 11 * M, open: 103, high: 103, low: 103, close: 103, volume: 0, confirmed: false },
    });
  });

  it('aligns the new candle to the existing grid even after skipped periods', () => {
    expect(applyTrade({ ...live, confirmed: true }, trade(103, 13 * M + 7_000), '1')?.candle.time).toBe(13 * M);
  });

  it('monthly: a trade on the 1st opens the new calendar month', () => {
    const feb: Candle = { ...live, time: Date.UTC(2026, 1, 1) };
    expect(applyTrade(feb, trade(1, Date.UTC(2026, 1, 28, 23)), 'M')?.kind).toBe('update');
    expect(applyTrade(feb, trade(1, Date.UTC(2026, 2, 1, 0, 0, 5)), 'M')?.candle.time).toBe(Date.UTC(2026, 2, 1));
    expect(applyTrade({ ...feb, confirmed: true }, trade(1, Date.UTC(2026, 4, 9)), 'M')?.candle.time).toBe(Date.UTC(2026, 4, 1));
  });

  it('ignores trades older than the last candle and works only with history', () => {
    expect(applyTrade(live, trade(1, 9 * M), '1')).toBeNull();
    expect(applyTrade(undefined, trade(1, 9 * M), '1')).toBeNull();
  });
});
