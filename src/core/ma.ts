import type { Candle } from './types';

/** 차트에 그리는 단순 이동평균선 (종가 기준, 진행 중인 봉 포함 — TradingView MA 기본과 같음) */
export const MA_LINES = [
  { period: 20, color: '#4C9AFF', label: 'MA20' },
  { period: 100, color: '#C77DFF', label: 'MA100' },
] as const;

export interface MaPoint {
  time: number;
  value: number;
}

function windowMean(candles: readonly Candle[], end: number, period: number): number {
  let sum = 0;
  for (let k = end - period + 1; k <= end; k++) sum += candles[k].close;
  return sum / period;
}

/** 단순 이동평균. period개가 모인 봉부터 값이 있다. 창마다 다시 더해 누적 오차가 없다 (1000봉 × 100 = 10만 번) */
export function sma(candles: readonly Candle[], period: number): MaPoint[] {
  const out: MaPoint[] = [];
  for (let i = period - 1; i < candles.length; i++) out.push({ time: candles[i].time, value: windowMean(candles, i, period) });
  return out;
}

/** i번째 봉의 이동평균 (봉이 period개 미만이면 null) */
export function smaAt(candles: readonly Candle[], i: number, period: number): MaPoint | null {
  if (i < period - 1 || i >= candles.length) return null;
  return { time: candles[i].time, value: windowMean(candles, i, period) };
}

/** 가장 최근 봉의 이동평균 (실시간 갱신용) */
export function lastSma(candles: readonly Candle[], period: number): MaPoint | null {
  return smaAt(candles, candles.length - 1, period);
}
