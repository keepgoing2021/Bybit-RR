import { atrSeries, type AtrMethod } from './atr';
import type { Candle } from './types';

export interface SpikeOptions {
  /** 직전 확정 캔들 몇 개를 후보로 볼지 (MVP 기본값 50) */
  lookback: number;
  atrPeriod: number;
  atrMethod: AtrMethod;
}

export interface SpikeResult {
  index: number;
  candle: Candle;
  /** 고저폭 ÷ 직전 ATR */
  score: number;
  /** 후보 바로 전 캔들까지의 ATR */
  atr: number;
  /** 점수를 계산할 수 있었던 후보 수 */
  evaluated: number;
}

const TIE_EPSILON = 1e-12;

/**
 * '가장 급격한 캔들' 선정 (설계 문서 D6·D7, 초기 가정).
 * 입력은 이미 확정 캔들만 걸러진 오름차순 배열이어야 한다.
 * 점수 = 고저폭 ÷ 후보 직전 ATR, 동점이면 더 최근 캔들. 양봉·음봉은 구분하지 않는다.
 */
export function selectSpikeCandle(candles: Candle[], opts: SpikeOptions): SpikeResult | null {
  const atr = atrSeries(candles, opts.atrPeriod, opts.atrMethod);
  const first = Math.max(1, candles.length - opts.lookback);
  let best: SpikeResult | null = null;
  let evaluated = 0;

  for (let i = first; i < candles.length; i++) {
    const prevAtr = atr[i - 1];
    if (prevAtr === null || prevAtr <= 0) continue;
    evaluated++;
    const c = candles[i];
    const score = (c.high - c.low) / prevAtr;
    if (!best || score >= best.score - TIE_EPSILON) {
      best = { index: i, candle: c, score, atr: prevAtr, evaluated: 0 };
    }
  }

  return best ? { ...best, evaluated } : null;
}
