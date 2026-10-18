import { describe, expect, it } from 'vitest';
import type { AutoSL, AutoTP } from '../../src/core/analysis';
import { formatClock, formatPct, formatTime, slRationale, tfName, tpRationale } from '../../src/ui/format';

const TZ = 'Asia/Seoul';
const at = Date.UTC(2026, 9, 18, 5, 15, 7); // KST 10월 18일 14:15:07

const sl = (over: Partial<AutoSL> = {}): AutoSL => ({
  price: 98.5, candidatePrice: 98.5, status: 'ok', reason: null,
  candle: { time: Date.UTC(2026, 9, 18, 5, 15), open: 1, high: 2, low: 0.5, close: 1, volume: 1, confirmed: true },
  score: 3.214, atr: 1, timeframe: '15', bufferTicks: 0, method: 'spike', ...over,
});

const tp = (over: Partial<AutoTP> = {}): AutoTP => ({
  price: 110, candidatePrice: 110, status: 'ok', reason: null, rr: 1.5, ...over,
});

describe('time formatting', () => {
  it('formatTime prints month, day and minutes in the given zone', () => {
    expect(formatTime(at, TZ)).toBe('10월 18일 14:15');
  });

  it('formatClock prints hours, minutes and seconds', () => {
    expect(formatClock(at, TZ)).toBe('14:15:07');
  });
});

describe('tfName', () => {
  it('names candles by their interval', () => {
    expect(tfName('15')).toBe('15분봉');
    expect(tfName('60')).toBe('1시간봉');
    expect(tfName('D')).toBe('일봉');
    expect(tfName('W')).toBe('주봉');
  });
});

describe('slRationale', () => {
  it('matches the spec example for LONG', () => {
    expect(slRationale(sl(), 'LONG', TZ)).toBe('SL: 15분봉 10월 18일 14:15 캔들 저가 (고저폭이 직전 ATR의 3.21배)');
  });

  it('mentions the buffer and uses the high for SHORT', () => {
    expect(slRationale(sl({ bufferTicks: 3 }), 'SHORT', TZ)).toBe(
      'SL: 15분봉 10월 18일 14:15 캔들 고가 + 버퍼 3틱 (고저폭이 직전 ATR의 3.21배)',
    );
  });

  it('shows the reason when no valid auto SL exists', () => {
    expect(slRationale(sl({ status: 'invalid', price: null, reason: '유효한 자동 SL 없음: X' }), 'LONG', TZ))
      .toBe('유효한 자동 SL 없음: X (선정 캔들 15분봉 10월 18일 14:15)');
    expect(slRationale(sl({ status: 'unavailable', price: null, candle: null, reason: '유효한 자동 SL 없음: 데이터 부족' }), 'LONG', TZ))
      .toBe('유효한 자동 SL 없음: 데이터 부족');
  });
});

describe('slRationale — previous higher-timeframe candle', () => {
  it('names the timeframe, the candle and the edge', () => {
    const a = sl({ method: 'prevCandle', timeframe: '720', score: null, atr: null });
    expect(slRationale(a, 'LONG', TZ)).toBe('SL: 12시간봉 직전 마감 봉 저가 (10월 18일 14:15 캔들)');
    expect(slRationale({ ...a, bufferTicks: 2 }, 'SHORT', TZ)).toBe('SL: 12시간봉 직전 마감 봉 고가 + 버퍼 2틱 (10월 18일 14:15 캔들)');
  });
});

describe('slRationale — last N bars', () => {
  const a = sl({ method: 'lowestN', timeframe: '240', score: null, atr: null, bars: 20 });

  it('names the timeframe, the bar count, the edge and the candle', () => {
    expect(slRationale(a, 'LONG', TZ)).toBe('SL: 4시간봉 최근 20봉 최저가 (10월 18일 14:15 캔들)');
    expect(slRationale({ ...a, bufferTicks: 2 }, 'SHORT', TZ)).toBe('SL: 4시간봉 최근 20봉 최고가 + 버퍼 2틱 (10월 18일 14:15 캔들)');
  });

  it('says when the extreme is in the bar still in progress', () => {
    expect(slRationale({ ...a, candle: { ...a.candle!, confirmed: false } }, 'LONG', TZ)).toBe(
      'SL: 4시간봉 최근 20봉 최저가 (진행 중인 10월 18일 14:15 캔들)',
    );
  });
});

describe('slRationale — swing', () => {
  it('names the timeframe, the swing kind and the candle', () => {
    const a = sl({ method: 'swing', timeframe: '240', score: null, atr: null });
    expect(slRationale(a, 'LONG', TZ)).toBe('SL: 4시간봉 최근 확정 스윙 저점 (10월 18일 14:15 캔들)');
    expect(slRationale({ ...a, bufferTicks: 2 }, 'SHORT', TZ)).toBe('SL: 4시간봉 최근 확정 스윙 고점 + 버퍼 2틱 (10월 18일 14:15 캔들)');
  });
});

describe('tpRationale', () => {
  it('names the default RR', () => {
    expect(tpRationale(tp(), 'LONG', TZ)).toBe('TP: 기본 손익비 1:1.5 (손익비 점선이나 입력으로 바꿀 수 있음)');
  });

  it('shows the reason when there is no auto TP', () => {
    expect(tpRationale(tp({ status: 'unavailable', price: null, rr: null, reason: '유효한 자동 TP 없음: SL 없음' }), 'LONG', TZ))
      .toBe('유효한 자동 TP 없음: SL 없음');
  });
});

describe('formatPct', () => {
  it('prints two decimals with an optional sign', () => {
    expect(formatPct(1.2345)).toBe('1.23%');
    expect(formatPct(1.2345, true)).toBe('+1.23%');
    expect(formatPct(-0.5, true)).toBe('−0.50%');
  });
});
