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

/** 가격이 구간 안(경계 포함)인지 */
export function inHuntZone(z: HuntZone, price: number): boolean {
  return price >= Math.min(z.near, z.far) && price <= Math.max(z.near, z.far);
}
