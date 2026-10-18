import type { Candle } from './types';

export type AtrMethod = 'wilder' | 'sma';

export function trueRange(c: Candle, prev?: Candle): number {
  if (!prev) return c.high - c.low;
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

/**
 * atr[i] = i번째 캔들까지 포함한 ATR. 계산할 수 없으면 null.
 * wilder: TradingView ta.atr과 같은 방식(첫 TR = 고가−저가, 첫 값 = 단순평균, 이후 RMA).
 */
export function atrSeries(candles: Candle[], period: number, method: AtrMethod): (number | null)[] {
  const tr = candles.map((c, i) => trueRange(c, candles[i - 1]));
  const out: (number | null)[] = candles.map(() => null);
  if (candles.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    if (method === 'wilder') {
      out[i] = ((out[i - 1] as number) * (period - 1) + tr[i]) / period;
    } else {
      sum += tr[i] - tr[i - period];
      out[i] = sum / period;
    }
  }
  return out;
}
