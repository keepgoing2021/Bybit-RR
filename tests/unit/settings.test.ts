import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/core/settings';

describe('DEFAULT_SETTINGS', () => {
  it('matches the MVP assumptions in the spec', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      lookback: 50,
      atrPeriod: 14,
      atrMethod: 'wilder',
      slBufferTicks: 0,
      swingBars: 2,
      tpMode: 'latest',
      boxExtendBars: 10,
      staleAfterSec: 15,
      maxPriceAgeSec: 60,
    });
  });
});

describe('sanitizeSettings', () => {
  it('clamps numbers into their allowed ranges and rounds to integers', () => {
    const s = sanitizeSettings({ lookback: 1, atrPeriod: 999, swingBars: 2.6, slBufferTicks: -3, boxExtendBars: 500 });
    expect(s.lookback).toBe(5);
    expect(s.atrPeriod).toBe(200);
    expect(s.swingBars).toBe(3);
    expect(s.slBufferTicks).toBe(0);
    expect(s.boxExtendBars).toBe(200);
  });

  it('falls back to defaults for unknown enum values and garbage', () => {
    expect(sanitizeSettings({ atrMethod: 'ema', tpMode: 'nearest' })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ lookback: 'abc' }).lookback).toBe(50);
  });

  it('keeps valid values', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, atrMethod: 'sma', tpMode: 'beyondEntry', lookback: 80 });
    expect(s.atrMethod).toBe('sma');
    expect(s.tpMode).toBe('beyondEntry');
    expect(s.lookback).toBe(80);
  });
});
