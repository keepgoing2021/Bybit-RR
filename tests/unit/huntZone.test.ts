import { describe, expect, it } from 'vitest';
import { HUNT_FAR_PCT, HUNT_NEAR_PCT, huntZone, inHuntZone } from '../../src/core/huntZone';

describe('huntZone (stop-hunting zone 2–10% beyond the SL wick)', () => {
  it('LONG: below the low, 2% to 10% out', () => {
    expect([HUNT_NEAR_PCT, HUNT_FAR_PCT]).toEqual([2, 10]);
    const z = huntZone('LONG', 100, 105)!;
    expect(z.near).toBeCloseTo(98, 9);
    expect(z.far).toBeCloseTo(90, 9);
  });

  it('SHORT: above the high, 2% to 10% out', () => {
    const z = huntZone('SHORT', 200, 190)!;
    expect(z.near).toBeCloseTo(204, 9);
    expect(z.far).toBeCloseTo(220, 9);
  });

  it('no zone when the wick is on the wrong side of entry or the input is bad', () => {
    expect(huntZone('LONG', 106, 105)).toBeNull();
    expect(huntZone('LONG', 105, 105)).toBeNull();
    expect(huntZone('SHORT', 180, 190)).toBeNull();
    expect(huntZone('LONG', 0, 105)).toBeNull();
    expect(huntZone('LONG', 100, 105, 10, 2)).toBeNull();
  });

  it('inside check includes both edges', () => {
    const z = huntZone('LONG', 100, 105)!;
    expect(inHuntZone(z, 98)).toBe(true);
    expect(inHuntZone(z, 95)).toBe(true);
    expect(inHuntZone(z, 90)).toBe(true);
    expect(inHuntZone(z, 98.5)).toBe(false); // 꼬리 바로 밖 (여유 1.5%)
    expect(inHuntZone(z, 89)).toBe(false);
  });
});
