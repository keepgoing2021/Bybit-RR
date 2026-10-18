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
  price: 110, candidatePrice: 110, status: 'ok', reason: null,
  swing: { time: Date.UTC(2026, 9, 16, 23, 0), price: 110, confirmedAt: Date.UTC(2026, 9, 17, 7, 0) },
  timeframe: '240', ...over,
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

describe('tpRationale', () => {
  it('matches the spec example for LONG', () => {
    expect(tpRationale(tp(), 'LONG', TZ)).toBe('TP: 4시간봉의 확정 스윙 고점 (10월 17일 08:00 캔들, 10월 17일 16:00 확정)');
  });

  it('uses the swing low for SHORT', () => {
    expect(tpRationale(tp(), 'SHORT', TZ)).toContain('확정 스윙 저점');
  });

  it('shows the reason when no valid auto TP exists', () => {
    expect(tpRationale(tp({ status: 'unavailable', price: null, swing: null, reason: '유효한 자동 TP 없음: 상위 시간봉 미선택' }), 'LONG', TZ))
      .toBe('유효한 자동 TP 없음: 상위 시간봉 미선택');
  });
});

describe('formatPct', () => {
  it('prints two decimals with an optional sign', () => {
    expect(formatPct(1.2345)).toBe('1.23%');
    expect(formatPct(1.2345, true)).toBe('+1.23%');
    expect(formatPct(-0.5, true)).toBe('−0.50%');
  });
});
