import { describe, expect, it } from 'vitest';
import { barRemainingMs, formatCountdown } from '../../src/core/countdown';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('barRemainingMs', () => {
  it('is the time until the current bar closes on the exchange clock', () => {
    expect(barRemainingMs(0, 15 * MIN, 2 * MIN + 30_000)).toBe(12 * MIN + 30_000);
  });

  it('never goes below zero while waiting for the next bar', () => {
    expect(barRemainingMs(0, MIN, MIN + 5_000)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('uses mm:ss under an hour', () => {
    expect(formatCountdown(12 * MIN + 30_000)).toBe('12:30');
    expect(formatCountdown(59_400)).toBe('01:00'); // 남은 초는 올림
    expect(formatCountdown(0)).toBe('00:00');
  });

  it('uses hh:mm:ss from one hour', () => {
    expect(formatCountdown(3 * HOUR + 5 * MIN + 9_000)).toBe('03:05:09');
  });

  it('uses days and hours from one day', () => {
    expect(formatCountdown(12 * DAY + 14 * HOUR + 3 * MIN)).toBe('12d 14h');
  });
});
