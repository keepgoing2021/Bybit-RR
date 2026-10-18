import { describe, expect, it } from 'vitest';
import { analyzeAutoLevels, type AnalyzeInput } from '../../src/core/analysis';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

const SPIKE = { ...DEFAULT_SETTINGS, slMode: 'spike' as const };
import type { Candle } from '../../src/core/types';
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
    input({ settings: DEFAULT_SETTINGS, slTf: { timeframe: '240', candles: h4 }, cutoff: 2 * H4 + 30 * MIN, ...over });

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
    const r = analyzeAutoLevels(prevInput({ side: 'SHORT', settings: { ...DEFAULT_SETTINGS, slBufferTicks: 2 } }));
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
