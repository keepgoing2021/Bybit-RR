import type { Candle } from './types';

/** 차트 왼쪽 위 캔들 정보 (TradingView·Bybit 범례와 같은 정의) */
export interface CandleStats {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 전 봉 종가 대비 등락 (첫 봉은 자기 시가 대비) */
  change: number;
  changePct: number;
  /** 진폭: (고가 − 저가) ÷ 전 봉 종가 × 100 */
  amplitudePct: number;
  up: boolean;
}

export function candleStats(candles: readonly Candle[], i: number): CandleStats | null {
  const c = candles[i];
  if (!c) return null;
  const base = i > 0 ? candles[i - 1].close : c.open;
  const change = c.close - base;
  return {
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    change,
    changePct: base ? (change / base) * 100 : 0,
    amplitudePct: base ? ((c.high - c.low) / base) * 100 : 0,
    up: change >= 0,
  };
}

/**
 * 범례에 보여줄 봉: 마우스가 캔들 위면 그 봉, 마지막 캔들 오른쪽 빈 곳이나 차트 밖이면 현재(마지막) 봉.
 * logical은 차트의 논리 인덱스(봉 중앙이 정수).
 */
export function legendIndex(logical: number | null, count: number): number | null {
  if (count === 0) return null;
  if (logical === null) return count - 1;
  return Math.min(count - 1, Math.max(0, Math.round(logical)));
}
