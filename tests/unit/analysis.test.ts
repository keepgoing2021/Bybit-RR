import { describe, expect, it } from 'vitest';
import { analyzeAutoLevels, type AnalyzeInput } from '../../src/core/analysis';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

import type { Candle } from '../../src/core/types';

const SPIKE = { ...DEFAULT_SETTINGS, slMode: 'spike' as const };
const PREV = { ...DEFAULT_SETTINGS, slMode: 'prevCandle' as const };
const LOWEST = { ...DEFAULT_SETTINGS, slMode: 'lowestN' as const };
import { fromHighs, MIN, ranged } from './helpers/candles';

const ones = (n: number) => Array.from({ length: n }, () => 1);
const M15 = 15 * MIN;

/** 1분봉 30개, 20번째가 고저폭 3 스파이크 (저가 98.5, 고가 101.5) */
function ltfWithSpike(): Candle[] {
  const r = ones(30);
  r[20] = 3;
  return ranged(r);
}

function input(over: Partial<AnalyzeInput> = {}): AnalyzeInput {
  return {
    side: 'LONG',
    entry: 100,
    cutoff: 30 * MIN,
    tickSize: 0.1,
    ltf: { timeframe: '1', candles: ltfWithSpike() },
    htf: null,
    slTf: null,
    settings: SPIKE,
    ...over,
  };
}

describe('analyzeAutoLevels — SL', () => {
  it('LONG SL is the spike candle low', () => {
    const r = analyzeAutoLevels(input());
    expect(r.sl.status).toBe('ok');
    expect(r.sl.price).toBe(98.5);
    expect(r.sl.candle?.time).toBe(20 * MIN);
    expect(r.sl.score).toBe(3);
    expect(r.sl.timeframe).toBe('1');
    expect(r.sl.method).toBe('spike');
  });

  it('buffer 3 ticks lowers LONG SL by 3 ticks', () => {
    const r = analyzeAutoLevels(input({ settings: { ...SPIKE, slBufferTicks: 3 } }));
    expect(r.sl.price).toBe(98.2);
    expect(r.sl.bufferTicks).toBe(3);
  });

  it('SHORT SL is the spike high plus buffer', () => {
    const r = analyzeAutoLevels(input({ side: 'SHORT', settings: { ...SPIKE, slBufferTicks: 2 } }));
    expect(r.sl.price).toBe(101.7);
  });

  it('bigger spike after cutoff is ignored', () => {
    const candles = ranged([...ones(20), 3, ...ones(9), 10]); // index 30은 cutoff(30분)에 아직 진행 중
    const r = analyzeAutoLevels(input({ ltf: { timeframe: '1', candles } }));
    expect(r.sl.candle?.time).toBe(20 * MIN);
  });

  it('unconfirmed candle is ignored', () => {
    const candles = ltfWithSpike();
    candles[29] = { ...candles[29], high: 105, low: 95, confirmed: false };
    const r = analyzeAutoLevels(input({ ltf: { timeframe: '1', candles }, cutoff: 60 * MIN }));
    expect(r.sl.candle?.time).toBe(20 * MIN);
  });

  it('LONG SL at or above entry is invalid', () => {
    const r = analyzeAutoLevels(input({ entry: 98 }));
    expect(r.sl.status).toBe('invalid');
    expect(r.sl.price).toBeNull();
    expect(r.sl.candidatePrice).toBe(98.5);
    expect(r.sl.reason).toContain('유효한 자동 SL 없음');
  });

  it('empty candles gives unavailable SL', () => {
    const r = analyzeAutoLevels(input({ ltf: { timeframe: '1', candles: [] } }));
    expect(r.sl.status).toBe('unavailable');
    expect(r.sl.price).toBeNull();
    expect(r.sl.reason).toContain('데이터 부족');
  });
});

describe('analyzeAutoLevels — TP', () => {
  it('TP is latest confirmed HTF swing high', () => {
    const htf = fromHighs([100, 101, 110, 103, 102, 104, 103], 0, M15);
    const r = analyzeAutoLevels(input({ cutoff: 7 * M15, htf: { timeframe: '15', candles: htf } }));
    expect(r.tp.status).toBe('ok');
    expect(r.tp.price).toBe(110);
    expect(r.tp.timeframe).toBe('15');
    expect(r.tp.swing).toEqual({ time: 2 * M15, price: 110, confirmedAt: 5 * M15 });
  });

  it('swing confirmed after cutoff is not used', () => {
    const htf = fromHighs([100, 101, 108, 102, 101, 115, 103, 102], 0, M15);
    const before = analyzeAutoLevels(input({ cutoff: 7 * M15, htf: { timeframe: '15', candles: htf } }));
    expect(before.tp.price).toBe(108);
    const after = analyzeAutoLevels(input({ cutoff: 8 * M15, htf: { timeframe: '15', candles: htf } }));
    expect(after.tp.price).toBe(115);
  });

  it('SHORT TP below entry from the latest swing low', () => {
    const htf: Candle[] = [105, 104, 96, 101, 102, 103, 104].map((low, i) => ({
      time: i * M15, open: low + 0.5, high: low + 1, low, close: low + 0.5, volume: 1, confirmed: true,
    }));
    const r = analyzeAutoLevels(input({ side: 'SHORT', cutoff: 7 * M15, htf: { timeframe: '15', candles: htf } }));
    expect(r.tp.price).toBe(96);
  });

  it('LONG latest swing high below entry is invalid and not replaced', () => {
    const htf = fromHighs([100, 101, 110, 103, 102, 104, 103], 0, M15);
    const r = analyzeAutoLevels(input({ entry: 111, cutoff: 7 * M15, htf: { timeframe: '15', candles: htf } }));
    expect(r.tp.status).toBe('invalid');
    expect(r.tp.price).toBeNull();
    expect(r.tp.candidatePrice).toBe(110);
    expect(r.tp.reason).toContain('유효한 자동 TP 없음');
  });

  it('htf null gives unavailable TP', () => {
    const r = analyzeAutoLevels(input());
    expect(r.tp.status).toBe('unavailable');
    expect(r.tp.price).toBeNull();
    expect(r.tp.timeframe).toBeNull();
  });
});

describe('analyzeAutoLevels — SL from the previous higher-timeframe candle', () => {
  const H4 = 240 * MIN;
  // 4시간봉 3개: [0,4h) [4h,8h) [8h,12h)
  const h4: Candle[] = [
    { time: 0, open: 100, high: 104, low: 97, close: 101, volume: 1, confirmed: true },
    { time: H4, open: 101, high: 103, low: 98.4, close: 100, volume: 1, confirmed: true },
    { time: 2 * H4, open: 100, high: 102, low: 99, close: 100.5, volume: 1, confirmed: false },
  ];
  const prevInput = (over: Partial<AnalyzeInput> = {}) =>
    input({ settings: PREV, slTf: { timeframe: '240', candles: h4 }, cutoff: 2 * H4 + 30 * MIN, ...over });

  it('LONG SL is the low of the last candle that closed before the entry', () => {
    const r = analyzeAutoLevels(prevInput());
    expect(r.sl.status).toBe('ok');
    expect(r.sl.method).toBe('prevCandle');
    expect(r.sl.timeframe).toBe('240');
    expect(r.sl.candle?.time).toBe(H4);
    expect(r.sl.price).toBe(98.4);
    expect(r.sl.score).toBeNull();
  });

  it('SHORT SL is that candle high plus buffer', () => {
    const r = analyzeAutoLevels(prevInput({ side: 'SHORT', settings: { ...PREV, slBufferTicks: 2 } }));
    expect(r.sl.price).toBe(103.2);
  });

  it('a candle still in progress at the entry is never used', () => {
    const r = analyzeAutoLevels(prevInput({ cutoff: 2 * H4 - 1 }));
    expect(r.sl.candle?.time).toBe(0);
    expect(r.sl.price).toBe(97);
  });

  it('LONG SL at or above entry is invalid and not replaced', () => {
    const r = analyzeAutoLevels(prevInput({ entry: 98 }));
    expect(r.sl.status).toBe('invalid');
    expect(r.sl.price).toBeNull();
    expect(r.sl.candidatePrice).toBe(98.4);
    expect(r.sl.reason).toContain('유효한 자동 SL 없음');
  });

  it('no closed candle on the SL timeframe gives unavailable', () => {
    const r = analyzeAutoLevels(prevInput({ cutoff: H4 - 1 }));
    expect(r.sl.status).toBe('unavailable');
    expect(r.sl.reason).toContain('데이터 부족');
  });

  it('missing SL timeframe data gives unavailable with the reason', () => {
    const r = analyzeAutoLevels(prevInput({ slTf: null }));
    expect(r.sl.status).toBe('unavailable');
    expect(r.sl.reason).toContain('SL 기준 시간봉');
  });
});

describe('analyzeAutoLevels — SL from the lowest low / highest high of the last N bars', () => {
  const H4 = 240 * MIN;
  // 사용자 화면(4시간봉) 재현: 직전 봉 저가 78.263, 두 봉 앞 꼬리 77.055, 엔트리 78.615
  const LOWS = [76.5, 80, 79.5, 77.5, 78.9, 77.055, 78.4, 78.263];
  const bars = (lows: number[], formingLow?: number): Candle[] => {
    const out: Candle[] = lows.map((low, i) => ({
      time: i * H4, open: low + 1, high: low + 2, low, close: low + 1.2, volume: 1, confirmed: true,
    }));
    if (formingLow !== undefined) {
      out.push({ time: lows.length * H4, open: 78.5, high: 79, low: formingLow, close: 78.6, volume: 1, confirmed: false });
    }
    return out;
  };
  const lowInput = (over: Partial<AnalyzeInput> = {}, candles = bars(LOWS, 78.3)) =>
    input({
      entry: 78.615,
      tickSize: 0.001,
      cutoff: LOWS.length * H4 + 30 * MIN,
      ltf: { timeframe: '240', candles },
      settings: { ...LOWEST, slLowestBars: 7 },
      ...over,
    });

  it('LONG SL is the lowest low of the last N closed bars, not just the previous bar', () => {
    const r = analyzeAutoLevels(lowInput());
    expect(r.sl.status).toBe('ok');
    expect(r.sl.method).toBe('lowestN');
    expect(r.sl.timeframe).toBe('240');
    expect(r.sl.price).toBe(77.055);
    expect(r.sl.candle?.time).toBe(5 * H4);
    expect(r.sl.bars).toBe(7);
  });

  it('bars older than N are not searched', () => {
    expect(analyzeAutoLevels(lowInput()).sl.price).toBe(77.055); // 76.5는 8봉 전
    const r = analyzeAutoLevels(lowInput({ settings: { ...LOWEST, slLowestBars: 8 } }));
    expect(r.sl.price).toBe(76.5);
    expect(r.sl.candle?.time).toBe(0);
  });

  it('the bar in progress at the entry counts with its low so far', () => {
    const r = analyzeAutoLevels(lowInput({}, bars(LOWS, 76.9)));
    expect(r.sl.price).toBe(76.9);
    expect(r.sl.candle?.time).toBe(LOWS.length * H4);
    expect(r.sl.candle?.confirmed).toBe(false);
  });

  it('bars that start after the entry are ignored', () => {
    const candles = bars(LOWS, 78.3);
    candles.push({ time: (LOWS.length + 1) * H4, open: 71, high: 72, low: 70, close: 71, volume: 1, confirmed: false });
    expect(analyzeAutoLevels(lowInput({}, candles)).sl.price).toBe(77.055);
  });

  it('SHORT SL is the highest high plus buffer', () => {
    const r = analyzeAutoLevels(lowInput({ side: 'SHORT', settings: { ...LOWEST, slLowestBars: 7, slBufferTicks: 2 } }));
    expect(r.sl.candle?.time).toBe(H4); // 고가 82
    expect(r.sl.price).toBe(82.002);
  });

  it('ties pick the most recent bar', () => {
    const r = analyzeAutoLevels(lowInput({ cutoff: 4 * H4 }, bars([77, 78, 77, 78.5])));
    expect(r.sl.candle?.time).toBe(2 * H4);
  });

  it('with fewer bars than N it uses what exists and records the count', () => {
    const r = analyzeAutoLevels(lowInput({ cutoff: 2 * H4, settings: LOWEST }, bars([79, 77.8])));
    expect(r.sl.price).toBe(77.8);
    expect(r.sl.bars).toBe(2);
  });

  it('LONG: a lowest low at or above the entry is invalid and not replaced', () => {
    const r = analyzeAutoLevels(lowInput({ entry: 77 }));
    expect(r.sl.status).toBe('invalid');
    expect(r.sl.price).toBeNull();
    expect(r.sl.candidatePrice).toBe(77.055);
    expect(r.sl.reason).toContain('유효한 자동 SL 없음');
  });

  it('no bars before the entry gives unavailable', () => {
    const r = analyzeAutoLevels(lowInput({}, []));
    expect(r.sl.status).toBe('unavailable');
    expect(r.sl.reason).toContain('데이터 부족');
  });
});

describe('analyzeAutoLevels — SL from the latest confirmed swing on the chart timeframe', () => {
  const H4 = 240 * MIN;
  const fromLows = (lows: number[], formingLow?: number): Candle[] => {
    const out: Candle[] = lows.map((low, i) => ({
      time: i * H4, open: low + 1, high: low + 2, low, close: low + 1.2, volume: 1, confirmed: true,
    }));
    if (formingLow !== undefined) {
      out.push({ time: lows.length * H4, open: 78.5, high: 79, low: formingLow, close: 78.6, volume: 1, confirmed: false });
    }
    return out;
  };
  // 사용자 화면(4시간봉) 재현: 직전 봉 저가 78.263, 세 봉 앞 꼬리 77.055(스윙 저점), 엔트리 78.615
  const LOWS = [76.5, 80, 79.5, 77.5, 78.9, 77.055, 78.4, 78.263];
  const swingInput = (over: Partial<AnalyzeInput> = {}, candles = fromLows(LOWS, 78.3), lows = LOWS) =>
    input({
      entry: 78.615,
      tickSize: 0.001,
      cutoff: lows.length * H4 + 30 * MIN,
      ltf: { timeframe: '240', candles },
      settings: DEFAULT_SETTINGS,
      ...over,
    });

  it('is the default SL mode', () => {
    expect(DEFAULT_SETTINGS.slMode).toBe('swing');
  });

  it('LONG SL is the latest confirmed swing low, not the previous bar low', () => {
    const r = analyzeAutoLevels(swingInput());
    expect(r.sl.status).toBe('ok');
    expect(r.sl.method).toBe('swing');
    expect(r.sl.timeframe).toBe('240');
    expect(r.sl.price).toBe(77.055);
    expect(r.sl.candle?.time).toBe(5 * H4);
  });

  it('a low without swingBars closed bars on its right is not a swing yet', () => {
    const lows = [80, 79.5, 77.5, 78.9, 78.5, 76.8, 77.2]; // 76.8은 오른쪽 마감 봉이 1개뿐
    const r = analyzeAutoLevels(swingInput({}, fromLows(lows, 77.3), lows));
    expect(r.sl.price).toBe(77.5);
  });

  it('the bar in progress is never used, even when it is lower', () => {
    expect(analyzeAutoLevels(swingInput({}, fromLows(LOWS, 70))).sl.price).toBe(77.055);
  });

  it('LONG skips swing lows above the entry and takes the latest one below it', () => {
    const lows = [79, 78, 76, 77, 78, 80, 79, 78.8, 79.5, 80.2]; // 78.8 스윙은 엔트리 위
    const r = analyzeAutoLevels(swingInput({}, fromLows(lows), lows));
    expect(r.sl.price).toBe(76);
    expect(r.sl.candle?.time).toBe(2 * H4);
  });

  it('SHORT SL is the latest swing high above the entry plus buffer', () => {
    const highs = [78, 79, 81, 79.5, 79.2, 79.8, 80.1];
    const candles: Candle[] = highs.map((high, i) => ({
      time: i * H4, open: high - 1, high, low: high - 1.5, close: high - 0.8, volume: 1, confirmed: true,
    }));
    const r = analyzeAutoLevels(
      swingInput({ side: 'SHORT', cutoff: highs.length * H4, settings: { ...DEFAULT_SETTINGS, slBufferTicks: 2 } }, candles),
    );
    expect(r.sl.candle?.time).toBe(2 * H4);
    expect(r.sl.price).toBe(81.002);
  });

  it('no swing low below the entry gives unavailable with the reason', () => {
    const r = analyzeAutoLevels(swingInput({ entry: 75 }));
    expect(r.sl.status).toBe('unavailable');
    expect(r.sl.price).toBeNull();
    expect(r.sl.reason).toContain('엔트리 아래에 확정 스윙 저점 없음');
  });

  it('too few closed bars gives unavailable', () => {
    const r = analyzeAutoLevels(swingInput({ cutoff: 3 * H4 }, fromLows([79, 78, 77])));
    expect(r.sl.status).toBe('unavailable');
    expect(r.sl.reason).toContain('데이터 부족');
  });
});
