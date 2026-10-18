import { describe, expect, it } from 'vitest';
import { barEnd, barStart, defaultSlTf, isClosedBy, prevBarStart, slTimeframes, tfLabel, tfMs, TIMEFRAMES } from '../../src/core/timeframe';
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
  it('lists every Bybit interval including monthly', () => {
    expect(TIMEFRAMES).toEqual(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M']);
  });
});

describe('monthly bars follow the calendar', () => {
  const U = Date.UTC;
  it('starts on the 1st of the month 00:00 UTC and ends at the next 1st', () => {
    expect(barStart('M', U(2026, 1, 15, 13, 5))).toBe(U(2026, 1, 1));
    expect(barEnd('M', U(2026, 1, 1))).toBe(U(2026, 2, 1)); // 2월 28일
    expect(barEnd('M', U(2026, 0, 1))).toBe(U(2026, 1, 1)); // 1월 31일
    expect(barEnd('M', U(2026, 11, 1))).toBe(U(2027, 0, 1));
    expect(prevBarStart('M', U(2026, 0, 1))).toBe(U(2025, 11, 1));
  });

  it('fixed-length intervals keep their grid', () => {
    expect(barStart('240', U(2026, 9, 18, 9, 30))).toBe(U(2026, 9, 18, 8));
    expect(barEnd('240', U(2026, 9, 18, 8))).toBe(U(2026, 9, 18, 12));
    expect(prevBarStart('240', U(2026, 9, 18, 8))).toBe(U(2026, 9, 18, 4));
  });

  it('a monthly candle is closed exactly when its calendar month ends', () => {
    expect(isClosedBy(candle(U(2026, 1, 1)), 'M', U(2026, 2, 1))).toBe(true);
    expect(isClosedBy(candle(U(2026, 1, 1)), 'M', U(2026, 2, 1) - 1)).toBe(false);
    expect(isClosedBy(candle(U(2026, 0, 1)), 'M', U(2026, 0, 31))).toBe(false); // 30일 지나도 1월은 진행 중
  });
});

describe('tfLabel', () => {
  it('labels minutes, hours, day and week in Korean', () => {
    expect(tfLabel('15')).toBe('15분');
    expect(tfLabel('60')).toBe('1시간');
    expect(tfLabel('240')).toBe('4시간');
    expect(tfLabel('D')).toBe('일');
    expect(tfLabel('W')).toBe('주');
    expect(tfLabel('M')).toBe('월');
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

describe('defaultSlTf', () => {
  it('uses the user-specified pairs', () => {
    expect(defaultSlTf('15')).toBe('240');
    expect(defaultSlTf('240')).toBe('720');
    expect(defaultSlTf('D')).toBe('W');
  });

  it('fills the remaining timeframes one step up', () => {
    expect(defaultSlTf('1')).toBe('15');
    expect(defaultSlTf('3')).toBe('15');
    expect(defaultSlTf('5')).toBe('60');
    expect(defaultSlTf('30')).toBe('240');
    expect(defaultSlTf('60')).toBe('240');
    expect(defaultSlTf('120')).toBe('720');
    expect(defaultSlTf('360')).toBe('D');
    expect(defaultSlTf('720')).toBe('D');
  });

  it('weekly uses monthly, monthly falls back to the previous monthly candle', () => {
    expect(defaultSlTf('W')).toBe('M');
    expect(defaultSlTf('M')).toBe('M');
  });
});

describe('slTimeframes', () => {
  it('offers the chart timeframe and everything above it', () => {
    expect(slTimeframes('240')).toEqual(['240', '360', '720', 'D', 'W', 'M']);
    expect(slTimeframes('W')).toEqual(['W', 'M']);
  });
});
