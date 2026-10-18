import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZING,
  planSizing,
  sanitizeSizing,
  splitPrices,
  splitShares,
  type SizingInput,
} from '../../src/core/sizing';

const base = (over: Partial<SizingInput> = {}): SizingInput => ({
  side: 'LONG',
  entry: 100,
  sl: 90,
  tp: 120,
  tickSize: 0.1,
  settings: { capital: 10_000, riskPct: 1, splits: 3, weightMode: 'linear', showAvgLine: true },
  ...over,
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('splitPrices', () => {
  it('divides the entry→SL distance into equal steps, first at the entry, never at the SL', () => {
    expect(splitPrices('LONG', 100, 90, 3, 0.1)).toEqual([100, 96.7, 93.3]);
    expect(splitPrices('LONG', 100, 90, 5, 0.1)).toEqual([100, 98, 96, 94, 92]);
    expect(splitPrices('SHORT', 100, 110, 3, 0.1)).toEqual([100, 103.3, 106.7]);
    expect(splitPrices('LONG', 100, 90, 1, 0.1)).toEqual([100]);
  });
});

describe('splitShares', () => {
  it('linear: later entries get more money (1:2:3, 1:2:3:4:5)', () => {
    expect(splitShares([100, 96.7, 93.3], 90, 'linear').map((x) => x * 6)).toEqual([1, 2, 3].map((x) => expect.closeTo(x, 9)));
    expect(splitShares([100, 98, 96, 94, 92], 90, 'linear').map((x) => x * 15)).toEqual([1, 2, 3, 4, 5].map((x) => expect.closeTo(x, 9)));
  });

  it('shares always add up to 1', () => {
    expect(sum(splitShares([100, 98, 96, 94, 92], 90, 'equalRisk'))).toBeCloseTo(1, 12);
  });
});

describe('planSizing — loss at SL equals the chosen % of capital', () => {
  it('3 splits linear: money grows 1:2:3 and the full loss at SL is exactly 1% of capital', () => {
    const r = planSizing(base());
    if (!r.ok) throw new Error(r.reason);
    const p = r.plan;
    expect(p.riskBudget).toBe(100);
    expect(p.tranches.map((t) => t.price)).toEqual([100, 96.7, 93.3]);
    expect(p.tranches.map((t) => t.notional)).toEqual([290.12, 580.24, 870.37].map((x) => expect.closeTo(x, 2)));
    expect(p.totalNotional).toBeCloseTo(1740.73, 2);
    expect(p.lossAtSl).toBeCloseTo(100, 9);
    expect(p.lossPct).toBeCloseTo(1, 9);
    expect(p.leverage).toBeCloseTo(0.174, 3);
  });

  it('reports the average entry and RR if every split fills', () => {
    const r = planSizing(base());
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.avgEntry).toBeCloseTo(95.485, 3);
    expect(r.plan.profitAtTp).toBeCloseTo(446.91, 2);
    expect(r.plan.rr).toBeCloseTo(4.469, 3);
  });

  it('a single entry matches the plain RR', () => {
    const r = planSizing(base({ settings: { ...base().settings, splits: 1 } }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches).toHaveLength(1);
    expect(r.plan.totalNotional).toBeCloseTo(1000, 9); // 손실 100 ÷ 손절폭 10%
    expect(r.plan.rr).toBeCloseTo(2, 12);
  });

  it('5 splits linear', () => {
    const r = planSizing(base({ settings: { ...base().settings, splits: 5 } }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches.map((t) => t.notional)).toEqual([137.05, 274.1, 411.14, 548.19, 685.24].map((x) => expect.closeTo(x, 2)));
    expect(r.plan.lossAtSl).toBeCloseTo(100, 9);
  });

  it('equal-risk weights lose the same amount on every split', () => {
    const r = planSizing(base({ settings: { ...base().settings, weightMode: 'equalRisk' } }));
    if (!r.ok) throw new Error(r.reason);
    for (const t of r.plan.tranches) expect(t.loss).toBeCloseTo(100 / 3, 9);
    expect(r.plan.tranches.map((t) => t.notional)).toEqual([333.33, 481.09, 942.42].map((x) => expect.closeTo(x, 2)));
  });

  it('SHORT mirrors LONG', () => {
    const r = planSizing(base({ side: 'SHORT', sl: 110, tp: 80 }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches.map((t) => t.price)).toEqual([100, 103.3, 106.7]);
    expect(r.plan.lossAtSl).toBeCloseTo(100, 9);
    expect(r.plan.avgEntry).toBeGreaterThan(100);
  });
});

describe('planSizing — order size rules', () => {
  it('rounds each quantity down to the qty step, so the loss never exceeds the budget', () => {
    const r = planSizing(base({ qtyStep: 0.1 }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches.map((t) => t.qty)).toEqual([2.9, 6, 9.3]);
    expect(r.plan.lossAtSl).toBeLessThanOrEqual(100);
    expect(r.plan.lossAtSl).toBeCloseTo(2.9 * 10 + 6 * 6.7 + 9.3 * 3.3, 9);
  });

  it('flags splits below the minimum order size', () => {
    const r = planSizing(base({ qtyStep: 0.1, minQty: 3, minNotional: 5 }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches.map((t) => t.tooSmall)).toEqual([true, false, false]);
    const tiny = planSizing(base({ qtyStep: 0.001, minNotional: 300 }));
    if (!tiny.ok) throw new Error(tiny.reason);
    expect(tiny.plan.tranches.map((t) => t.tooSmall)).toEqual([true, false, false]);
  });
});

describe('planSizing — when it cannot plan', () => {
  it('needs the capital', () => {
    const r = planSizing(base({ settings: { ...base().settings, capital: null } }));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('운영자산') });
  });

  it('needs an SL on the losing side of the entry', () => {
    expect(planSizing(base({ sl: null }))).toEqual({ ok: false, reason: expect.stringContaining('SL') });
    expect(planSizing(base({ sl: 101 }))).toEqual({ ok: false, reason: expect.stringContaining('SL') });
  });

  it('needs at least one tick per split between entry and SL', () => {
    expect(planSizing(base({ sl: 99.7, settings: { ...base().settings, splits: 5 } }))).toEqual({
      ok: false,
      reason: expect.stringContaining('5분할'),
    });
  });

  it('without a valid TP it still sizes but has no profit or RR', () => {
    const r = planSizing(base({ tp: null }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.profitAtTp).toBeNull();
    expect(r.plan.rr).toBeNull();
  });
});

describe('sanitizeSizing', () => {
  it('defaults: no capital yet, 1% risk, 3 splits, linear', () => {
    expect(DEFAULT_SIZING).toEqual({ capital: null, riskPct: 1, splits: 3, weightMode: 'linear', showAvgLine: true });
    expect(sanitizeSizing(null)).toEqual(DEFAULT_SIZING);
  });

  it('keeps valid values and clamps risk %', () => {
    expect(sanitizeSizing({ capital: 2500, riskPct: 0.5, splits: 5, weightMode: 'equalRisk', showAvgLine: false })).toEqual({
      capital: 2500, riskPct: 0.5, splits: 5, weightMode: 'equalRisk', showAvgLine: false,
    });
    expect(sanitizeSizing({ riskPct: 50 }).riskPct).toBe(10);
    expect(sanitizeSizing({ riskPct: 0 }).riskPct).toBe(0.1);
  });

  it('drops garbage', () => {
    expect(sanitizeSizing({ capital: -5, splits: 4, weightMode: 'x', riskPct: 'a', showAvgLine: 'no' })).toEqual(DEFAULT_SIZING);
  });
});
