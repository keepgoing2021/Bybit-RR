import { barEnd } from './timeframe';
import type { Candle, PriceTick, Timeframe } from './types';

/**
 * 체결 하나를 마지막 캔들에 반영한다.
 * Bybit kline 푸시는 1~60초 간격이라, 그 사이에도 차트가 체결가를 따라가게 하기 위한 것.
 * - 같은 기간: 종가를 체결가로, 고가·저가를 넓힌다 (확정 캔들은 건드리지 않음)
 * - 새 기간: 임시 캔들을 연다 (미확정 → 자동 선정에는 쓰이지 않음, 이후 kline이 정식 값으로 덮어씀)
 */
export function applyTrade(
  last: Candle | undefined,
  tick: PriceTick,
  tf: Timeframe,
): { kind: 'update' | 'append'; candle: Candle } | null {
  if (!last || tick.time < last.time) return null;
  const p = tick.price;
  const end = barEnd(tf, last.time);
  if (tick.time < end) {
    if (last.confirmed) return null;
    return {
      kind: 'update',
      candle: { ...last, close: p, high: Math.max(last.high, p), low: Math.min(last.low, p) },
    };
  }
  // 마지막 캔들의 격자(거래소가 정한 시작 시각)를 이어 간다. 월봉은 달력 기준
  let start: number;
  if (tf === 'M') {
    start = end;
    while (barEnd(tf, start) <= tick.time) start = barEnd(tf, start);
  } else {
    const len = end - last.time;
    start = last.time + Math.floor((tick.time - last.time) / len) * len;
  }
  return {
    kind: 'append',
    candle: { time: start, open: p, high: p, low: p, close: p, volume: 0, confirmed: false },
  };
}
