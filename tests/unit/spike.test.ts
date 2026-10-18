import { describe, expect, it } from 'vitest';
import { selectSpikeCandle } from '../../src/core/spike';
import { fromOhlc, ranged } from './helpers/candles';

const ones = (n: number) => Array.from({ length: n }, () => 1);

describe('selectSpikeCandle', () => {
  it('picks the candle with the largest range relative to the ATR before it', () => {
    const candles = ranged([...ones(20), 3, ...ones(9)]);
    const r = selectSpikeCandle(candles, { lookback: 50, atrPeriod: 14, atrMethod: 'wilder' });
    expect(r?.index).toBe(20);
    expect(r?.score).toBe(3);
    expect(r?.atr).toBe(1);
  });

  it('its own range does not feed its ATR', () => {
    // Y: 고저폭 3, 갭 없음. X: 고저폭 4지만 갭으로 TR 10.
    // 직전 ATR 기준: X 4/(97/81)=3.34 > Y 3. 자기 ATR을 쓰면 X 0.97 < Y 1.8로 뒤집힌다.
    const rows: [number, number, number, number][] = [
      ...ranged([1, 1, 1, 1, 1]).map((c) => [c.open, c.high, c.low, c.close] as [number, number, number, number]),
      [100, 101.5, 98.5, 100], // Y (index 5)
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [108, 110, 106, 108], // X (index 9), 직전 종가 100 → TR 10
    ];
    const r = selectSpikeCandle(fromOhlc(rows), { lookback: 50, atrPeriod: 3, atrMethod: 'wilder' });
    expect(r?.index).toBe(9);
    expect(r?.score).toBeCloseTo(324 / 97, 10);
  });

  it('tie picks more recent', () => {
    const candles = ranged([1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 3, 1]);
    const r = selectSpikeCandle(candles, { lookback: 50, atrPeriod: 3, atrMethod: 'sma' });
    expect(r?.index).toBe(12);
  });

  it('candidate outside lookback ignored', () => {
    const ranges = ones(40);
    ranges[5] = 10;
    ranges[30] = 3;
    const r = selectSpikeCandle(ranged(ranges), { lookback: 20, atrPeriod: 3, atrMethod: 'sma' });
    expect(r?.index).toBe(30);
  });

  it('returns null when no candidate has a prior ATR', () => {
    expect(selectSpikeCandle(ranged(ones(5)), { lookback: 50, atrPeriod: 14, atrMethod: 'wilder' })).toBeNull();
    expect(selectSpikeCandle([], { lookback: 50, atrPeriod: 14, atrMethod: 'wilder' })).toBeNull();
  });

  it('skips candidates whose prior ATR is zero', () => {
    const r = selectSpikeCandle(ranged([0, 0, 0, 2, 1]), { lookback: 50, atrPeriod: 3, atrMethod: 'sma' });
    expect(r?.index).toBe(4);
    expect(r?.evaluated).toBe(1);
  });

  it('ignores candle direction', () => {
    const rows: [number, number, number, number][] = [
      ...ranged(ones(5)).map((c) => [c.open, c.high, c.low, c.close] as [number, number, number, number]),
      [101, 101.5, 98.5, 99], // 음봉 스파이크 (고저폭 3)
      [100, 100.5, 99.5, 100],
    ];
    const r = selectSpikeCandle(fromOhlc(rows), { lookback: 50, atrPeriod: 3, atrMethod: 'sma' });
    expect(r?.index).toBe(5);
  });
});
