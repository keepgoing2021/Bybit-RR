import { formatPrice, snapToTick } from './price';
import type { AnalysisSettings } from './settings';
import { selectSpikeCandle } from './spike';
import { findSwings, selectSwingTarget } from './swing';
import { isClosedBy, tfMs } from './timeframe';
import type { Candle, Side, Timeframe } from './types';

export type LevelStatus = 'ok' | 'invalid' | 'unavailable';

export interface AutoSL {
  /** 적용 가능한 자동 SL. 무효·불가면 null */
  price: number | null;
  /** 규칙이 계산한 값(무효여도 기록) */
  candidatePrice: number | null;
  status: LevelStatus;
  reason: string | null;
  candle: Candle | null;
  score: number | null;
  atr: number | null;
  timeframe: Timeframe;
  bufferTicks: number;
}

export interface AutoTP {
  price: number | null;
  candidatePrice: number | null;
  status: LevelStatus;
  reason: string | null;
  swing: { time: number; price: number; confirmedAt: number } | null;
  timeframe: Timeframe | null;
}

export interface AutoLevels {
  sl: AutoSL;
  tp: AutoTP;
}

export interface AnalyzeInput {
  side: Side;
  entry: number;
  /** 기준 시각 = 엔트리 가격의 거래소 시각 (ms). 이 시각까지 확정된 캔들만 사용한다. */
  cutoff: number;
  tickSize: number;
  ltf: { timeframe: Timeframe; candles: Candle[] };
  htf: { timeframe: Timeframe; candles: Candle[] } | null;
  settings: AnalysisSettings;
}

/**
 * SL·TP 자동 제안. RR은 고려하지 않는다 — 가격 구조만 본다.
 * 무효한 값은 price=null로 두고 사유를 남기며, 다른 후보로 대체하지 않는다.
 */
export function analyzeAutoLevels(i: AnalyzeInput): AutoLevels {
  return { sl: analyzeSL(i), tp: analyzeTP(i) };
}

function analyzeSL(i: AnalyzeInput): AutoSL {
  const { side, entry, cutoff, tickSize, ltf, settings } = i;
  const base: AutoSL = {
    price: null,
    candidatePrice: null,
    status: 'unavailable',
    reason: null,
    candle: null,
    score: null,
    atr: null,
    timeframe: ltf.timeframe,
    bufferTicks: settings.slBufferTicks,
  };

  const closed = ltf.candles.filter((c) => isClosedBy(c, ltf.timeframe, cutoff));
  const spike = selectSpikeCandle(closed, {
    lookback: settings.lookback,
    atrPeriod: settings.atrPeriod,
    atrMethod: settings.atrMethod,
  });
  if (!spike) {
    return {
      ...base,
      reason: `유효한 자동 SL 없음: 데이터 부족 (확정 캔들 ${closed.length}개, ATR ${settings.atrPeriod} 계산에 최소 ${settings.atrPeriod + 1}개 필요)`,
    };
  }

  const buffer = settings.slBufferTicks * tickSize;
  const candidate = snapToTick(side === 'LONG' ? spike.candle.low - buffer : spike.candle.high + buffer, tickSize);
  const withSpike = { ...base, candle: spike.candle, score: spike.score, atr: spike.atr, candidatePrice: candidate };
  const valid = side === 'LONG' ? candidate < entry : candidate > entry;

  if (!valid) {
    const what = side === 'LONG' ? '저가' : '고가';
    const cmp = side === 'LONG' ? '이상' : '이하';
    return {
      ...withSpike,
      status: 'invalid',
      reason: `유효한 자동 SL 없음: 선정 캔들 ${what}(버퍼 포함) ${formatPrice(candidate, tickSize)}이(가) 엔트리 ${formatPrice(entry, tickSize)} ${cmp}`,
    };
  }
  return { ...withSpike, price: candidate, status: 'ok' };
}

function analyzeTP(i: AnalyzeInput): AutoTP {
  const { side, entry, cutoff, tickSize, htf, settings } = i;
  if (!htf) {
    return {
      price: null,
      candidatePrice: null,
      status: 'unavailable',
      reason: '유효한 자동 TP 없음: 상위 시간봉 미선택',
      swing: null,
      timeframe: null,
    };
  }

  const closed = htf.candles.filter((c) => isClosedBy(c, htf.timeframe, cutoff));
  const base: AutoTP = {
    price: null,
    candidatePrice: null,
    status: 'unavailable',
    reason: null,
    swing: null,
    timeframe: htf.timeframe,
  };
  if (closed.length < settings.swingBars * 2 + 1) {
    return { ...base, reason: `유효한 자동 TP 없음: 데이터 부족 (상위 시간봉 확정 캔들 ${closed.length}개)` };
  }

  const target = selectSwingTarget(side, findSwings(closed, settings.swingBars), entry, settings.tpMode);
  if (!target.swing) return { ...base, reason: target.reason };

  const s = target.swing;
  const price = snapToTick(s.price, tickSize);
  const swing = { time: s.time, price, confirmedAt: closed[s.confirmIndex].time + tfMs(htf.timeframe) };
  if (target.status !== 'ok') {
    return { ...base, status: target.status, reason: target.reason, swing, candidatePrice: price };
  }
  return { ...base, status: 'ok', price, candidatePrice: price, swing };
}
