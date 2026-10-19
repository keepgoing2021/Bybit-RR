import { describe, expect, it } from 'vitest';
import { HUNT_FAR_PCT, HUNT_NEAR_PCT, huntTip, huntZone, inHuntZone } from '../../src/core/huntZone';

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

  it('tip: the auto wick while SL is auto; a dragged SL moves it by the same ratio (SL ÷ (1 ∓ margin))', () => {
    expect(huntTip('LONG', 'auto', 99, 100, 1)).toBe(100);
    expect(huntTip('LONG', 'auto', null, null, 0)).toBeNull();
    // 여유 0%: 옮긴 SL이 곧 꼬리 → 구간은 SL에서 2~10% 바깥
    expect(huntTip('LONG', 'manual', 95, 100, 0)).toBe(95);
    // 여유 1%: 자동 SL 99(=100×0.99)를 94.05로 옮기면 꼬리도 95로 → SL과 구간 사이 간격 비율이 그대로
    expect(huntTip('LONG', 'manual', 94.05, 100, 1)).toBeCloseTo(95, 9);
    expect(huntTip('SHORT', 'manual', 212.1, 200, 1)).toBeCloseTo(210, 9);
    // 자동 꼬리가 없어도 옮긴 SL이 있으면 그것으로
    expect(huntTip('LONG', 'manual', 95, null, 0)).toBe(95);
    // 여유 2%: SL은 늘 구간의 가까운 경계 위 → 구간 안 (옮겨도 같음)
    const tip = huntTip('LONG', 'manual', 90, 100, 2)!;
    expect(inHuntZone(huntZone('LONG', tip, 120)!, 90)).toBe(true);
  });
});
