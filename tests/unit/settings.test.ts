import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/core/settings';

describe('DEFAULT_SETTINGS', () => {
  it('matches the MVP assumptions in the spec', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      slMode: 'swing',
      slLowestBars: 20,
      lookback: 50,
      atrPeriod: 14,
      atrMethod: 'wilder',
      slBufferPct: 0,
      swingBars: 2,
      defaultRR: 1.5,
      boxExtendBars: 10,
      boxOffsetBars: 2,
      staleAfterSec: 15,
      maxPriceAgeSec: 60,
    });
  });
});

describe('sanitizeSettings', () => {
  it('clamps numbers into their allowed ranges and rounds to integers', () => {
    const s = sanitizeSettings({ lookback: 1, atrPeriod: 999, swingBars: 2.6, slBufferPct: -3, boxExtendBars: 500 });
    expect(s.lookback).toBe(5);
    expect(s.atrPeriod).toBe(200);
    expect(s.swingBars).toBe(3);
    expect(s.slBufferPct).toBe(0);
    // SL 여유는 % (소수 셋째 자리, 0~10). 이전 버전의 틱 단위 값은 버린다
    expect(sanitizeSettings({ slBufferPct: 0.12345 }).slBufferPct).toBe(0.123);
    expect(sanitizeSettings({ slBufferPct: 50 }).slBufferPct).toBe(10);
    expect(sanitizeSettings({ slBufferTicks: 5 }).slBufferPct).toBe(0);
    expect(s.boxExtendBars).toBe(200);
    expect(sanitizeSettings({ slLowestBars: 0 }).slLowestBars).toBe(1);
    expect(sanitizeSettings({ slLowestBars: 9999 }).slLowestBars).toBe(500);
    expect(sanitizeSettings({ boxOffsetBars: 99 }).boxOffsetBars).toBe(50);
    expect(sanitizeSettings({ boxOffsetBars: -1 }).boxOffsetBars).toBe(0);
  });

  it('falls back to defaults for unknown enum values and garbage', () => {
    expect(sanitizeSettings({ atrMethod: 'ema', slMode: 'ema', defaultRR: 'x' })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ lookback: 'abc' }).lookback).toBe(50);
  });

  it('keeps valid values', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, atrMethod: 'sma', lookback: 80, slMode: 'spike', defaultRR: 1.7 });
    expect(s.slMode).toBe('spike');
    expect(sanitizeSettings({ slMode: 'prevCandle' }).slMode).toBe('prevCandle');
    expect(sanitizeSettings({ slMode: 'lowestN' }).slMode).toBe('lowestN');
    expect(sanitizeSettings({ slMode: 'swing' }).slMode).toBe('swing');
    expect(s.atrMethod).toBe('sma');
    expect(s.defaultRR).toBe(1.7); // 정수로 반올림하지 않는다
    expect(sanitizeSettings({ defaultRR: 50 }).defaultRR).toBe(20);
    expect(sanitizeSettings({ defaultRR: 0 }).defaultRR).toBe(0.1);
    expect(sanitizeSettings({ defaultRR: 1.234 }).defaultRR).toBe(1.23);
    expect(s.lookback).toBe(80);
  });
});
