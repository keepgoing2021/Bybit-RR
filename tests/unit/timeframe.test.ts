import { describe, expect, it } from 'vitest';
import { defaultHigherTf, higherTimeframes, isClosedBy, tfLabel, tfMs, TIMEFRAMES } from '../../src/core/timeframe';
import type { Candle } from '../../src/core/types';

const candle = (time: number, confirmed = true): Candle => ({
  time, open: 1, high: 1, low: 1, close: 1, volume: 0, confirmed,
});

describe('tfMs', () => {
  it('converts Bybit intervals to milliseconds', () => {
    expect(tfMs('1')).toBe(60_000);
    expect(tfMs('15')).toBe(900_000);
    expect(tfMs('240')).toBe(14_400_000);
    expect(tfMs('D')).toBe(86_400_000);
    expect(tfMs('W')).toBe(604_800_000);
  });
});

describe('TIMEFRAMES', () => {
  it('excludes the monthly interval because its length varies', () => {
    expect(TIMEFRAMES).not.toContain('M');
    expect(TIMEFRAMES).toEqual(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W']);
  });
});

describe('tfLabel', () => {
  it('labels minutes, hours, day and week in Korean', () => {
    expect(tfLabel('15')).toBe('15분');
    expect(tfLabel('60')).toBe('1시간');
    expect(tfLabel('240')).toBe('4시간');
    expect(tfLabel('D')).toBe('일');
    expect(tfLabel('W')).toBe('주');
  });
});

describe('defaultHigherTf', () => {
  it('follows the design table D10', () => {
    expect(defaultHigherTf('1')).toBe('15');
    expect(defaultHigherTf('3')).toBe('15');
    expect(defaultHigherTf('5')).toBe('60');
    expect(defaultHigherTf('15')).toBe('60');
    expect(defaultHigherTf('30')).toBe('240');
    expect(defaultHigherTf('60')).toBe('240');
    expect(defaultHigherTf('120')).toBe('D');
    expect(defaultHigherTf('240')).toBe('D');
    expect(defaultHigherTf('360')).toBe('D');
    expect(defaultHigherTf('720')).toBe('W');
    expect(defaultHigherTf('D')).toBe('W');
    expect(defaultHigherTf('W')).toBeNull();
  });
});

describe('higherTimeframes', () => {
  it('lists only strictly larger intervals', () => {
    expect(higherTimeframes('60')).toEqual(['120', '240', '360', '720', 'D', 'W']);
    expect(higherTimeframes('W')).toEqual([]);
  });
});

describe('isClosedBy', () => {
  it('is true only when the candle period has ended by the cutoff', () => {
    expect(isClosedBy(candle(0), '1', 60_000)).toBe(true);
    expect(isClosedBy(candle(0), '1', 59_999)).toBe(false);
  });

  it('is false for a candle the feed has not marked confirmed', () => {
    expect(isClosedBy(candle(0, false), '1', 120_000)).toBe(false);
  });
});
