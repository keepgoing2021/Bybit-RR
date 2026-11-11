import type { Trade } from './journal';

/**
 * 가상 거래 판정 (2026-11-11). 저널의 열린 거래를 1분 캔들로 따라가 손절·목표에 닿았는지 본다.
 * 화면·통신 없는 순수 계산. 통신은 data/bybit/klineRange.ts, 실행은 data/virtualTracker.ts.
 */
export const MIN = 60_000;

export interface MiniCandle {
  /** 캔들 시작 시각 (ms) */
  time: number;
  low: number;
  high: number;
}

export interface AutoClose {
  hit: 'sl' | 'tp';
  exit: number;
  /** 닿은 캔들이 끝난 시각 */
  closedAt: number;
}

/** 어느 분부터 볼지: 이미 본 데까지(trackedTo), 처음이면 진입한 분의 다음 분 (진입한 분은 진입 전 움직임이 섞여 있다) */
export function trackStart(t: Pick<Trade, 'openedAt' | 'trackedTo'>): number {
  const first = Math.floor(t.openedAt / MIN) * MIN + MIN;
  return t.trackedTo !== undefined && t.trackedTo > first ? t.trackedTo : first;
}

/**
 * 캔들(오래된 것부터)에서 처음 닿은 곳. 한 캔들에서 손절·목표에 둘 다 닿았으면 손절로 본다
 * (어느 쪽이 먼저였는지 1분 캔들로는 알 수 없어서, 좋게 봐주지 않는다).
 */
export function resolveByCandles(t: Trade, candles: readonly MiniCandle[]): AutoClose | null {
  const from = trackStart(t);
  const long = t.side === 'LONG';
  for (const c of candles) {
    if (c.time < from || !Number.isFinite(c.low) || !Number.isFinite(c.high)) continue;
    const slHit = long ? c.low <= t.sl : c.high >= t.sl;
    if (slHit) return { hit: 'sl', exit: t.sl, closedAt: c.time + MIN };
    const tpHit = t.tp !== null && (long ? c.high >= t.tp : c.low <= t.tp);
    if (tpHit) return { hit: 'tp', exit: t.tp!, closedAt: c.time + MIN };
  }
  return null;
}
