import { findSwings } from './swing';
import type { Candle } from './types';

/**
 * 다우 이론 시장 구조 (2026-11-04). 프랍 트레이더가 쓰는 표기를 따른다:
 * - 스윙마다 직전 같은 종류와 비교한 이름 — 고점 HH(더 높음)/LH, 저점 HL/LL(더 낮음)
 * - BOS: 직전 스윙을 **종가로** 넘어 추세가 이어짐. CHoCH: 추세 반대쪽 스윙이 깨져 추세가 바뀜
 *   (상승 중 마지막 저점이 깨지면 CHoCH 하락, 하락 중 마지막 고점이 깨지면 CHoCH 상승)
 * - 꼬리만 찌르고 종가가 안쪽이면 돌파가 아니다(가짜 돌파 거르기)
 * - 스윙은 오른쪽 bars개가 마감돼 확정된 다음 봉부터만 돌파를 센다 → 지나고 나서 표시가 바뀌지 않는다
 * 입력은 **마감된 캔들만**이어야 한다(진행 중인 봉을 넣으면 그 봉 종가로 미리 돌파가 잡힌다).
 */
export type StructLabel = 'HH' | 'LH' | 'HL' | 'LL';
export type Trend = 'up' | 'down';

export interface StructPoint {
  kind: 'high' | 'low';
  index: number;
  time: number;
  price: number;
  /** 직전 같은 종류 스윙과 비교한 이름. 첫 고점·첫 저점은 null */
  label: StructLabel | null;
}

export interface StructBreak {
  type: 'BOS' | 'CHoCH';
  dir: Trend;
  /** 깨진 스윙 가격 */
  price: number;
  /** 깨진 스윙 캔들 */
  fromIndex: number;
  fromTime: number;
  /** 종가로 깬 캔들 */
  index: number;
  time: number;
}

export interface MarketStructure {
  points: StructPoint[];
  breaks: StructBreak[];
  /** 마지막 돌파 기준 지금 추세 (아직 돌파가 없으면 null) */
  trend: Trend | null;
}

export function marketStructure(candles: readonly Candle[], bars: number): MarketStructure {
  const swings = findSwings(candles as Candle[], bars).sort((a, b) => a.index - b.index);

  const points: StructPoint[] = [];
  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  for (const s of swings) {
    let label: StructLabel | null = null;
    if (s.kind === 'high') {
      if (prevHigh !== null) label = s.price > prevHigh ? 'HH' : 'LH';
      prevHigh = s.price;
    } else {
      if (prevLow !== null) label = s.price < prevLow ? 'LL' : 'HL';
      prevLow = s.price;
    }
    points.push({ kind: s.kind, index: s.index, time: s.time, price: s.price, label });
  }

  // 확정 시점 순으로 스윙을 '살아 있는 레벨'로 올리고, 각 캔들 종가로 돌파를 본다
  const byConfirm = [...swings].sort((a, b) => a.confirmIndex - b.confirmIndex);
  let next = 0;
  let activeHigh: (typeof swings)[number] | null = null;
  let activeLow: (typeof swings)[number] | null = null;
  let trend: Trend | null = null;
  const breaks: StructBreak[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    // 확정 봉 자체는 아직 돌파 판단에 쓰지 않는다 — 확정된 다음 봉부터
    if (activeHigh && c.close > activeHigh.price) {
      breaks.push({ type: trend === 'down' ? 'CHoCH' : 'BOS', dir: 'up', price: activeHigh.price, fromIndex: activeHigh.index, fromTime: activeHigh.time, index: i, time: c.time });
      trend = 'up';
      activeHigh = null;
    }
    if (activeLow && c.close < activeLow.price) {
      breaks.push({ type: trend === 'up' ? 'CHoCH' : 'BOS', dir: 'down', price: activeLow.price, fromIndex: activeLow.index, fromTime: activeLow.time, index: i, time: c.time });
      trend = 'down';
      activeLow = null;
    }
    while (next < byConfirm.length && byConfirm[next].confirmIndex <= i) {
      const s = byConfirm[next++];
      if (s.kind === 'high') activeHigh = s;
      else activeLow = s;
    }
  }
  return { points, breaks, trend };
}
