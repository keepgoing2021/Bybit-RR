import type { Candle } from '../../../src/core/types';

export const MIN = 60_000;

/** OHLC 배열로 1분 간격 캔들을 만든다. time = start + i분 */
export function fromOhlc(rows: [number, number, number, number][], start = 0, stepMs = MIN): Candle[] {
  return rows.map(([open, high, low, close], i) => ({
    time: start + i * stepMs,
    open,
    high,
    low,
    close,
    volume: 1,
    confirmed: true,
  }));
}

/** 가운데가 center이고 고저폭이 range인 갭 없는 캔들 (TR = range) */
export function ranged(ranges: number[], center = 100, start = 0, stepMs = MIN): Candle[] {
  return fromOhlc(
    ranges.map((r) => [center, center + r / 2, center - r / 2, center]),
    start,
    stepMs,
  );
}

/** 고가 배열로 캔들을 만든다(저가 = 고가 − 1). 스윙 고점 테스트용 */
export function fromHighs(highs: number[], start = 0, stepMs = MIN): Candle[] {
  return fromOhlc(
    highs.map((h) => [h - 0.5, h, h - 1, h - 0.5]),
    start,
    stepMs,
  );
}

/** 저가 배열로 캔들을 만든다(고가 = 저가 + 1). 스윙 저점 테스트용 */
export function fromLows(lows: number[], start = 0, stepMs = MIN): Candle[] {
  return fromOhlc(
    lows.map((l) => [l + 0.5, l + 1, l, l + 0.5]),
    start,
    stepMs,
  );
}
