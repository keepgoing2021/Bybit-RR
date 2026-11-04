import { findSwings } from './swing';
import type { Candle } from './types';

/**
 * 다우 이론 시장 구조 (2026-11-04). 프랍 트레이더가 쓰는 표기를 따른다:
 * - 스윙마다 직전 같은 종류와 비교한 이름 — 고점 HH(더 높음)/LH, 저점 HL/LL(더 낮음)
 * - BOS: 직전 스윙을 **종가로** 넘어 추세가 이어짐. CHoCH: 추세 반대쪽 스윙이 깨져 추세가 바뀜
 *   (상승 중 마지막 저점이 깨지면 CHoCH 하락, 하락 중 마지막 고점이 깨지면 CHoCH 상승)
 * - 꼬리만 찌르고 종가가 안쪽이면 돌파가 아니다(가짜 돌파 거르기)
 * - 스윙은 오른쪽 bars개가 마감돼 확정된 다음 봉부터만 돌파를 센다 → 지나고 나서 표시가 바뀌지 않는다
 * - 추세전환(CHoCH)은 **강하게 깬 것만** 인정한다(ICT의 MSS, 2026-11-04 사용자 요청):
 *   깬 다리(반대쪽 끝 → 깬 봉) 안에 깬 방향 몸통이 다리 시작 전 평균 몸통의 DISPLACEMENT_BODY배 이상이고
 *   거래량도 평균의 DISPLACEMENT_VOLUME배 이상인 봉이 있을 때(다우 이론: 거래량이 추세를 확인해야 한다, 사용자 제안).
 *   약하게 깬 역방향 돌파는 표시하지 않고 추세도 바꾸지 않는다(그 레벨은 깨진 것으로 치워 둔다).
 *   추세 방향 돌파(BOS)는 세기와 상관없이 표시한다
 *   기준 고른 근거(BTC·ETH·SOL 15분·1시간 1000봉 실측, 추세전환 개수): 필터 없음 21~25 → 몸통만 10~17 →
 *   몸통+거래량 1.5배 7~15. 거래량 2배까지 올리면 4~15로 1시간봉 진짜 전환까지 지나치게 빠졌다
 *   - FVG도 강함으로 치면 거의 모든 다리에 FVG가 있어 걸러지지 않았다
 *   - 깬 봉 근처(3봉)만 보면 더 줄지만(8~14), 큰 장대봉으로 바닥에서 튀어 오른 뒤 천천히 고점을 깬
 *     진짜 전환(11/4 BTC 15분 15시)을 놓쳤다 — MSS는 '깬 움직임 전체'에 강한 봉이 있어야 한다는 뜻
 *   - 평균은 다리 시작 전 봉으로 잰다: 다리 안의 큰 봉이 평균을 키워 스스로를 가리지 않게
 * 입력은 **마감된 캔들만**이어야 한다(진행 중인 봉을 넣으면 그 봉 종가로 미리 돌파가 잡힌다).
 */
export const DISPLACEMENT_BODY = 2.5;
export const DISPLACEMENT_VOLUME = 1.5;
/** 평균 몸통을 잴 직전 봉 수 */
export const DISPLACEMENT_LOOKBACK = 20;

/** j번 봉이 dir 방향으로 '강하게' 움직였나: baseEnd 직전 DISPLACEMENT_LOOKBACK봉 평균보다 깬 방향 몸통 DISPLACEMENT_BODY배·거래량 DISPLACEMENT_VOLUME배 이상 */
export function isDisplacement(candles: readonly Candle[], j: number, dir: 'up' | 'down', baseEnd = j): boolean {
  const c = candles[j];
  const move = dir === 'up' ? c.close - c.open : c.open - c.close;
  const from = Math.max(0, baseEnd - DISPLACEMENT_LOOKBACK);
  if (baseEnd - from < 5 || move <= 0) return false;
  let sum = 0;
  let vol = 0;
  for (let k = from; k < baseEnd; k++) {
    sum += Math.abs(candles[k].close - candles[k].open);
    vol += candles[k].volume;
  }
  const avg = sum / (baseEnd - from);
  const avgVol = vol / (baseEnd - from);
  // 거래량 정보가 없으면(전부 0) 몸통만 본다
  const volOk = avgVol <= 0 || c.volume >= DISPLACEMENT_VOLUME * avgVol;
  return avg > 0 && move >= DISPLACEMENT_BODY * avg && volOk;
}

/** 깨진 스윙(levelIndex) 이후 반대쪽 끝(위로 깨면 최저점, 아래로 깨면 최고점)부터 깬 봉 i까지에 강한 봉이 있나 */
function breakIsStrong(candles: readonly Candle[], levelIndex: number, i: number, dir: 'up' | 'down'): boolean {
  let start = levelIndex;
  for (let j = levelIndex + 1; j <= i; j++) {
    if (dir === 'up' ? candles[j].low < candles[start].low : candles[j].high > candles[start].high) start = j;
  }
  for (let j = start; j <= i; j++) if (isDisplacement(candles, j, dir, start)) return true;
  return false;
}

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
      const against = trend === 'down';
      if (!against || breakIsStrong(candles, activeHigh.index, i, 'up')) {
        breaks.push({ type: against ? 'CHoCH' : 'BOS', dir: 'up', price: activeHigh.price, fromIndex: activeHigh.index, fromTime: activeHigh.time, index: i, time: c.time });
        trend = 'up';
      }
      activeHigh = null;
    }
    if (activeLow && c.close < activeLow.price) {
      const against = trend === 'up';
      if (!against || breakIsStrong(candles, activeLow.index, i, 'down')) {
        breaks.push({ type: against ? 'CHoCH' : 'BOS', dir: 'down', price: activeLow.price, fromIndex: activeLow.index, fromTime: activeLow.time, index: i, time: c.time });
        trend = 'down';
      }
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
