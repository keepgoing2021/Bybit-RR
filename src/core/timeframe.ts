import type { Candle, Timeframe } from './types';

export const TIMEFRAMES: Timeframe[] = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M'];

const MINUTE = 60_000;

/**
 * 시간봉 길이 (ms). 월봉은 달마다 길이가 달라 30일을 명목값으로 쓴다 — 순서 비교·근사 계산용.
 * 캔들 경계(시작·끝·마감 판정)는 반드시 barStart/barEnd를 쓴다.
 */
export function tfMs(tf: Timeframe): number {
  if (tf === 'D') return 1440 * MINUTE;
  if (tf === 'W') return 7 * 1440 * MINUTE;
  if (tf === 'M') return 30 * 1440 * MINUTE;
  return Number(tf) * MINUTE;
}

/** t가 속한 캔들의 시작 시각. 월봉은 매월 1일 00:00 UTC (Bybit 월봉 기준) */
export function barStart(tf: Timeframe, t: number): number {
  if (tf === 'M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  const ms = tfMs(tf);
  return Math.floor(t / ms) * ms;
}

/** start에 시작한 캔들이 끝나는 시각 (= 다음 캔들 시작) */
export function barEnd(tf: Timeframe, start: number): number {
  if (tf === 'M') {
    const d = new Date(start);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return start + tfMs(tf);
}

/** start에 시작한 캔들 바로 앞 캔들의 시작 시각 */
export function prevBarStart(tf: Timeframe, start: number): number {
  if (tf === 'M') {
    const d = new Date(start);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  }
  return start - tfMs(tf);
}

export function tfLabel(tf: Timeframe): string {
  if (tf === 'D') return '일';
  if (tf === 'W') return '주';
  if (tf === 'M') return '월';
  const minutes = Number(tf);
  return minutes >= 60 ? `${minutes / 60}시간` : `${minutes}분`;
}

/**
 * SL 기준 시간봉 기본값: 차트보다 한 단계 위. 15분→4시간, 4시간→12시간, 1일→1주는 사용자 지정.
 * 월봉은 더 큰 시간봉이 없어 직전 월봉을 쓴다.
 */
const DEFAULT_SL: Record<Timeframe, Timeframe> = {
  '1': '15',
  '3': '15',
  '5': '60',
  '15': '240',
  '30': '240',
  '60': '240',
  '120': '720',
  '240': '720',
  '360': 'D',
  '720': 'D',
  D: 'W',
  W: 'M',
  M: 'M',
};

export function defaultSlTf(tf: Timeframe): Timeframe {
  return DEFAULT_SL[tf];
}

/** SL 기준으로 고를 수 있는 시간봉: 차트 시간봉과 그 위 */
export function slTimeframes(tf: Timeframe): Timeframe[] {
  return TIMEFRAMES.filter((t) => tfMs(t) >= tfMs(tf));
}

/** 기준 시각까지 마감됐고 공급원이 확정으로 표시한 캔들인지 (설계 문서 D5) */
export function isClosedBy(c: Candle, tf: Timeframe, cutoffMs: number): boolean {
  return c.confirmed && barEnd(tf, c.time) <= cutoffMs;
}
