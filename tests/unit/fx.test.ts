import { describe, expect, it } from 'vitest';
import { fxValue, lastTwo, tvFxPair } from '../../src/core/fx';

describe('환율 (ECB)', () => {
  it('트레이딩뷰 이름 → 통화쌍', () => {
    expect(tvFxPair('FX_IDC:USDKRW')).toEqual({ base: 'USD', quote: 'KRW', mult: 1 });
    expect(tvFxPair('FX_IDC:JPYKRW*100')).toEqual({ base: 'JPY', quote: 'KRW', mult: 100 });
    expect(tvFxPair('FOREXCOM:AUDUSD')).toEqual({ base: 'AUD', quote: 'USD', mult: 1 });
    expect(tvFxPair('OANDA:EUR_USD')).toEqual({ base: 'EUR', quote: 'USD', mult: 1 });
    expect(tvFxPair('NYSE:KO')).toBeNull();
    expect(tvFxPair('FX:COPPER')).toBeNull();
  });
  it('USD 기준표로 교차 환율', () => {
    const rates = { KRW: 1358.73, JPY: 158.33, AUD: 1.4554 };
    expect(fxValue(rates, { base: 'USD', quote: 'KRW', mult: 1 })).toBeCloseTo(1358.73);
    expect(fxValue(rates, { base: 'JPY', quote: 'KRW', mult: 100 })).toBeCloseTo(858.16, 1);
    expect(fxValue(rates, { base: 'AUD', quote: 'USD', mult: 1 })).toBeCloseTo(0.6871, 3);
    expect(fxValue(rates, { base: 'XXX', quote: 'KRW', mult: 1 })).toBeNull();
  });
  it('기간 응답에서 마지막 두 날', () => {
    const r = lastTwo({ rates: { '2026-11-05': { KRW: 1350 }, '2026-11-06': { KRW: 1358 } } })!;
    expect(r.date).toBe('2026-11-06');
    expect(r.prev).toEqual({ KRW: 1350 });
    expect(lastTwo({})).toBeNull();
  });
});
