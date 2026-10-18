import { formatPrice, snapToTick } from './price';
import type { AnalysisSettings, SlMode } from './settings';
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
  /** settings.slMode와 같은 의미. 선정 규칙을 기록한다 */
  method: SlMode;
  /** lowestN: 실제로 탐색한 마감 봉 수 (데이터가 N개보다 적으면 그 수) */
  bars?: number;
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
  /** SL 기준 시간봉 캔들 (prevCandle 방식에서 사용) */
  slTf: { timeframe: Timeframe; candles: Candle[] } | null;
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
  switch (i.settings.slMode) {
    case 'swing':
      return analyzeSwingSL(i);
    case 'lowestN':
      return analyzeLowestSL(i);
    case 'spike':
      return analyzeSpikeSL(i);
    default:
      return analyzePrevCandleSL(i);
  }
}

/**
 * 차트 시간봉의 확정 스윙 저점(LONG)·고점(SHORT) 중 엔트리 너머에 있는 가장 최근 것.
 * 스윙은 오른쪽에 swingBars개 봉이 마감돼야 확정되므로 진행 중인 봉은 쓰지 않는다.
 */
function analyzeSwingSL(i: AnalyzeInput): AutoSL {
  const { side, entry, cutoff, ltf, settings } = i;
  const base = emptySL(i, ltf.timeframe, 'swing');
  const closed = ltf.candles.filter((c) => isClosedBy(c, ltf.timeframe, cutoff));
  const need = settings.swingBars * 2 + 1;
  if (closed.length < need) {
    return { ...base, reason: `유효한 자동 SL 없음: 데이터 부족 (확정 캔들 ${closed.length}개, 스윙 판별에 최소 ${need}개 필요)` };
  }
  const kind = side === 'LONG' ? 'low' : 'high';
  const beyond = (p: number) => (side === 'LONG' ? p < entry : p > entry);
  const swing = findSwings(closed, settings.swingBars)
    .filter((s) => s.kind === kind)
    .reverse()
    .find((s) => beyond(s.price));
  if (!swing) {
    const where = side === 'LONG' ? '아래' : '위';
    return { ...base, reason: `유효한 자동 SL 없음: 엔트리 ${where}에 확정 스윙 ${kind === 'low' ? '저점' : '고점'} 없음` };
  }
  return finishSL(i, base, closed[swing.index], {});
}

/** 차트 시간봉 최근 N개 마감 봉 + 엔트리 시점에 진행 중인 봉(그때까지의 값) 중 최저가(LONG)·최고가(SHORT) */
function analyzeLowestSL(i: AnalyzeInput): AutoSL {
  const { side, cutoff, ltf, settings } = i;
  const base = emptySL(i, ltf.timeframe, 'lowestN');
  const ms = tfMs(ltf.timeframe);
  const closed = ltf.candles.filter((c) => isClosedBy(c, ltf.timeframe, cutoff)).slice(-settings.slLowestBars);
  const forming = ltf.candles.find((c) => !isClosedBy(c, ltf.timeframe, cutoff) && c.time <= cutoff && cutoff < c.time + ms);
  const pool = forming ? [...closed, forming] : closed;
  if (pool.length === 0) {
    return { ...base, reason: '유효한 자동 SL 없음: 데이터 부족 (엔트리 이전 캔들 없음)' };
  }
  let pick = pool[0];
  for (const c of pool) {
    // 같은 값이면 더 최근 봉
    if (side === 'LONG' ? c.low <= pick.low : c.high >= pick.high) pick = c;
  }
  return finishSL(i, base, pick, { bars: closed.length });
}

/** 선정 캔들의 꼬리 끝(+버퍼)을 SL 후보로 만들고, 엔트리 반대편이 아니면 무효 처리 */
function finishSL(i: AnalyzeInput, base: AutoSL, candle: Candle, extra: Partial<AutoSL>): AutoSL {
  const { side, entry, tickSize, settings } = i;
  const buffer = settings.slBufferTicks * tickSize;
  const candidate = snapToTick(side === 'LONG' ? candle.low - buffer : candle.high + buffer, tickSize);
  const withCandle = { ...base, ...extra, candle, candidatePrice: candidate };
  const valid = side === 'LONG' ? candidate < entry : candidate > entry;
  if (!valid) {
    const what = side === 'LONG' ? '저가' : '고가';
    const cmp = side === 'LONG' ? '이상' : '이하';
    return {
      ...withCandle,
      status: 'invalid',
      reason: `유효한 자동 SL 없음: 선정 캔들 ${what}(버퍼 포함) ${formatPrice(candidate, tickSize)}이(가) 엔트리 ${formatPrice(entry, tickSize)} ${cmp}`,
    };
  }
  return { ...withCandle, price: candidate, status: 'ok' };
}

function emptySL(i: AnalyzeInput, timeframe: Timeframe, method: AutoSL['method']): AutoSL {
  return {
    price: null,
    candidatePrice: null,
    status: 'unavailable',
    reason: null,
    candle: null,
    score: null,
    atr: null,
    timeframe,
    bufferTicks: i.settings.slBufferTicks,
    method,
  };
}

/** SL 기준 시간봉에서 엔트리 시점 직전에 마감된 봉 1개의 저가(LONG)·고가(SHORT) */
function analyzePrevCandleSL(i: AnalyzeInput): AutoSL {
  if (!i.slTf) {
    return { ...emptySL(i, i.ltf.timeframe, 'prevCandle'), reason: '유효한 자동 SL 없음: SL 기준 시간봉 데이터 없음' };
  }
  const { timeframe, candles } = i.slTf;
  const base = emptySL(i, timeframe, 'prevCandle');
  const closed = candles.filter((c) => isClosedBy(c, timeframe, i.cutoff));
  const prev = closed[closed.length - 1];
  if (!prev) {
    return { ...base, reason: '유효한 자동 SL 없음: 데이터 부족 (SL 기준 시간봉에 마감된 봉 없음)' };
  }
  return finishSL(i, base, prev, {});
}

/** 차트 시간봉에서 가장 급격한 캔들 (이전 기본 방식) */
function analyzeSpikeSL(i: AnalyzeInput): AutoSL {
  const { cutoff, ltf, settings } = i;
  const base = emptySL(i, ltf.timeframe, 'spike');
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
  return finishSL(i, base, spike.candle, { score: spike.score, atr: spike.atr });
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
