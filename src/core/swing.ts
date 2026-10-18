import type { Candle, Side } from './types';

export interface Swing {
  kind: 'high' | 'low';
  /** 피벗 캔들 인덱스 */
  index: number;
  /** 피벗 캔들 시작 시각 (ms) */
  time: number;
  price: number;
  /** 이 스윙을 확정시키는 캔들 인덱스 (= index + bars). 그 캔들이 마감돼야 스윙이 확정된다. */
  confirmIndex: number;
}

export type TpMode = 'latest' | 'beyondEntry';

/**
 * 좌우 `bars`개 비교로 스윙을 찾는다 (설계 문서 D8, 초기 가정).
 * 고점: 왼쪽 bars개보다 엄격히 높고 오른쪽 bars개 이상. 저점은 대칭.
 * 오른쪽에 bars개가 없는 마지막 캔들들은 아직 확정되지 않았으므로 제외된다.
 * 입력은 기준 시각까지 확정된 캔들만이어야 한다.
 */
export function findSwings(candles: Candle[], bars: number): Swing[] {
  const out: Swing[] = [];
  for (let k = bars; k + bars < candles.length; k++) {
    const c = candles[k];
    let isHigh = true;
    let isLow = true;
    for (let j = k - bars; j < k; j++) {
      if (!(candles[j].high < c.high)) isHigh = false;
      if (!(candles[j].low > c.low)) isLow = false;
    }
    for (let j = k + 1; j <= k + bars; j++) {
      if (!(candles[j].high <= c.high)) isHigh = false;
      if (!(candles[j].low >= c.low)) isLow = false;
    }
    if (isHigh) out.push({ kind: 'high', index: k, time: c.time, price: c.high, confirmIndex: k + bars });
    if (isLow) out.push({ kind: 'low', index: k, time: c.time, price: c.low, confirmIndex: k + bars });
  }
  return out;
}

export interface SwingTarget {
  swing: Swing | null;
  status: 'ok' | 'invalid' | 'unavailable';
  reason: string | null;
}

/**
 * LONG은 확정 스윙 고점, SHORT는 확정 스윙 저점을 TP 후보로 고른다.
 * latest: 가장 최근 스윙(엔트리 반대편이면 무효 — 다른 값으로 대체하지 않음).
 * beyondEntry: 엔트리 너머에 있는 스윙 중 가장 최근 것.
 */
export function selectSwingTarget(side: Side, swings: Swing[], entry: number, mode: TpMode): SwingTarget {
  const kind = side === 'LONG' ? 'high' : 'low';
  const beyond = (s: Swing) => (side === 'LONG' ? s.price > entry : s.price < entry);
  const candidates = swings.filter((s) => s.kind === kind);
  const kindLabel = kind === 'high' ? '고점' : '저점';

  if (candidates.length === 0) {
    return { swing: null, status: 'unavailable', reason: `유효한 자동 TP 없음: 확정 스윙 ${kindLabel} 없음` };
  }

  if (mode === 'beyondEntry') {
    const hit = [...candidates].reverse().find(beyond);
    if (!hit) {
      return {
        swing: null,
        status: 'unavailable',
        reason: `유효한 자동 TP 없음: 엔트리 ${side === 'LONG' ? '위' : '아래'}에 확정 스윙 ${kindLabel} 없음`,
      };
    }
    return { swing: hit, status: 'ok', reason: null };
  }

  const latest = candidates[candidates.length - 1];
  if (!beyond(latest)) {
    return {
      swing: latest,
      status: 'invalid',
      reason: `유효한 자동 TP 없음: 가장 최근 스윙 ${kindLabel} ${latest.price}이(가) 엔트리 ${side === 'LONG' ? '이하' : '이상'}`,
    };
  }
  return { swing: latest, status: 'ok', reason: null };
}
