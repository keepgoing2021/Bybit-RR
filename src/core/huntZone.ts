import type { Side } from './types';

/**
 * 스탑헌팅존: SL 기준 꼬리 끝(LONG = 저가, SHORT = 고가)에서 바깥쪽으로 2%~10% 구간.
 * 꼬리 바로 밖에 몰린 손절 주문을 쓸고 가는 가격대로 보고, 차트에 해골 표시와 함께 칠한다.
 */
export const HUNT_NEAR_PCT = 2;
export const HUNT_FAR_PCT = 10;

export interface HuntZone {
  /** 꼬리에서 가까운 경계 (꼬리 ± 2%) */
  near: number;
  /** 먼 경계 (꼬리 ± 10%) */
  far: number;
}

/** 꼬리가 진입가의 손절 쪽(LONG은 아래, SHORT는 위)에 있을 때만 구간을 만든다 */
export function huntZone(side: Side, wick: number, entry: number, nearPct = HUNT_NEAR_PCT, farPct = HUNT_FAR_PCT): HuntZone | null {
  if (!(wick > 0) || !(nearPct >= 0) || !(farPct > nearPct)) return null;
  if (side === 'LONG' ? wick >= entry : wick <= entry) return null;
  const dir = side === 'LONG' ? -1 : 1;
  return { near: wick * (1 + (dir * nearPct) / 100), far: wick * (1 + (dir * farPct) / 100) };
}

/** 가격이 구간 안(경계 포함, 실수 오차 허용)인지 */
export function inHuntZone(z: HuntZone, price: number): boolean {
  const eps = Math.abs(price) * 1e-9;
  return price >= Math.min(z.near, z.far) - eps && price <= Math.max(z.near, z.far) + eps;
}

/**
 * 구간의 기준(꼬리 끝). 자동 SL이면 그 캔들의 꼬리 끝 그대로.
 * SL을 직접 옮겼으면 그 SL을 같은 여유(%)로 되짚은 자리 → SL을 끌면 구간도 같은 비율로 따라 움직인다
 * (자동 SL = 꼬리 × (1 − 여유)였으니, 옮긴 SL ÷ (1 − 여유)가 '옮긴 꼬리'). 자동 꼬리가 없어도 옮긴 SL이 있으면 그것으로
 */
export function huntTip(
  side: Side,
  slSource: 'auto' | 'manual',
  appliedSl: number | null,
  autoWick: number | null,
  bufferPct: number,
): number | null {
  if (slSource === 'manual' && appliedSl !== null && appliedSl > 0) {
    const b = Math.max(0, bufferPct) / 100;
    return side === 'LONG' ? appliedSl / (1 - b) : appliedSl / (1 + b);
  }
  return autoWick;
}
