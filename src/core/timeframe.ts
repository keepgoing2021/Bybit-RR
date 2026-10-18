import type { Candle, Timeframe } from './types';

export const TIMEFRAMES: Timeframe[] = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W'];

const MINUTE = 60_000;

export function tfMs(tf: Timeframe): number {
  if (tf === 'D') return 1440 * MINUTE;
  if (tf === 'W') return 7 * 1440 * MINUTE;
  return Number(tf) * MINUTE;
}

export function tfLabel(tf: Timeframe): string {
  if (tf === 'D') return '일';
  if (tf === 'W') return '주';
  const minutes = Number(tf);
  return minutes >= 60 ? `${minutes / 60}시간` : `${minutes}분`;
}

/** 설계 문서 D10: 현재 차트 시간봉에 대한 TP 분석용 상위 시간봉 기본값 (초기 가정) */
const DEFAULT_HIGHER: Record<Timeframe, Timeframe | null> = {
  '1': '15',
  '3': '15',
  '5': '60',
  '15': '60',
  '30': '240',
  '60': '240',
  '120': 'D',
  '240': 'D',
  '360': 'D',
  '720': 'W',
  D: 'W',
  W: null,
};

export function defaultHigherTf(tf: Timeframe): Timeframe | null {
  return DEFAULT_HIGHER[tf];
}

export function higherTimeframes(tf: Timeframe): Timeframe[] {
  return TIMEFRAMES.filter((t) => tfMs(t) > tfMs(tf));
}

/** 기준 시각까지 마감됐고 공급원이 확정으로 표시한 캔들인지 (설계 문서 D5) */
export function isClosedBy(c: Candle, tf: Timeframe, cutoffMs: number): boolean {
  return c.confirmed && c.time + tfMs(tf) <= cutoffMs;
}
