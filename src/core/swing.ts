import type { Candle } from './types';

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
