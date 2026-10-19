import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZING,
  EQUAL_RISK_WORD,
  FEE_RATES,
  FEE_TIERS,
  feeAtStop,
  feePctText,
  isFeeTier,
  linearRatio,
  MAX_SPLITS,
  parseSplitCount,
  parseWeights,
  planSizing,
  ratioLabel,
  readWeightsInput,
  resizeSplits,
  sanitizeSizing,
  splitPrices,
  splitShares,
  weightsText,
  type SizingInput,
  type SizingSettings,
} from '../../src/core/sizing';

const base = (over: Partial<SizingInput> = {}): SizingInput => ({
  side: 'LONG',
  entry: 100,
  sl: 90,
  tp: 120,
  tickSize: 0.1,
  settings: { capital: 10_000, riskPct: 1, splits: 3, weightMode: 'linear', customWeights: [], showAvgLine: true },
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

  it('custom weights are used as given ratios', () => {
    expect(splitShares([100, 96.7, 93.3], 90, 'custom', [1, 1, 2])).toEqual([0.25, 0.25, 0.5]);
    expect(splitShares([100, 95], 90, 'custom', [20, 80])).toEqual([0.2, 0.8]);
  });

  it('linear works for any count (1:2:…:n)', () => {
    expect(splitShares([100, 99, 98, 97], 90, 'linear').map((x) => x * 10)).toEqual([1, 2, 3, 4].map((x) => expect.closeTo(x, 9)));
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

describe('planSizing — average entry at each fill stage', () => {
  it('each split carries the average if every split up to it fills (1차 = entry, last = all filled)', () => {
    const r = planSizing(base());
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches.map((t) => t.avgIfFilled)).toEqual([100, 97.7755, 95.4854].map((x) => expect.closeTo(x, 4)));
    expect(r.plan.tranches.at(-1)!.avgIfFilled).toBeCloseTo(r.plan.avgEntry, 12);
  });

  it('uses the rounded quantities', () => {
    const r = planSizing(base({ qtyStep: 0.1 })); // 2.9, 6, 9.3
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches[1].avgIfFilled).toBeCloseTo((2.9 * 100 + 6 * 96.7) / 8.9, 9);
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
    expect(DEFAULT_SIZING).toEqual({ capital: null, riskPct: 1, splits: 3, weightMode: 'linear', customWeights: [], showAvgLine: true });
    expect(sanitizeSizing(null)).toEqual(DEFAULT_SIZING);
  });

  it('keeps valid values and clamps risk %', () => {
    expect(sanitizeSizing({ capital: 2500, riskPct: 0.5, splits: 5, weightMode: 'equalRisk', showAvgLine: false })).toEqual({
      capital: 2500, riskPct: 0.5, splits: 5, weightMode: 'equalRisk', customWeights: [], showAvgLine: false,
    });
    expect(sanitizeSizing({ riskPct: 50 }).riskPct).toBe(10);
    expect(sanitizeSizing({ riskPct: 0 }).riskPct).toBe(0.1);
  });

  it('any split count from 1 to MAX_SPLITS', () => {
    expect(MAX_SPLITS).toBe(10);
    for (const n of [1, 2, 4, 7, 10]) expect(sanitizeSizing({ splits: n }).splits).toBe(n);
    for (const n of [0, 11, 2.5, 'x']) expect(sanitizeSizing({ splits: n }).splits).toBe(3);
  });

  it('custom weights decide the split count; empty or bad custom falls back to linear', () => {
    expect(sanitizeSizing({ weightMode: 'custom', customWeights: [1, 1, 2], splits: 5 })).toMatchObject({ weightMode: 'custom', customWeights: [1, 1, 2], splits: 3 });
    expect(sanitizeSizing({ weightMode: 'custom', customWeights: [] })).toMatchObject({ weightMode: 'linear', customWeights: [] });
    expect(sanitizeSizing({ weightMode: 'custom', customWeights: [1, -1, 'a'] })).toMatchObject({ weightMode: 'linear', customWeights: [] });
  });

  it('drops garbage', () => {
    expect(sanitizeSizing({ capital: -5, splits: 40, weightMode: 'x', riskPct: 'a', showAvgLine: 'no' })).toEqual(DEFAULT_SIZING);
  });
});

describe('parseWeights', () => {
  it('reads ratios written with : / , or spaces', () => {
    expect(parseWeights('1:1:2')).toEqual([1, 1, 2]);
    expect(parseWeights('20/30/50')).toEqual([20, 30, 50]);
    expect(parseWeights(' 1, 2 ,3 ')).toEqual([1, 2, 3]);
    expect(parseWeights('1 2 3 4')).toEqual([1, 2, 3, 4]);
    expect(parseWeights('0.5:1.5')).toEqual([0.5, 1.5]);
    expect(parseWeights('100')).toEqual([100]);
  });

  it('rejects empty, zero, negative, text and more than MAX_SPLITS', () => {
    for (const t of ['', 'a:b', '1:0', '1:-1', '1::2', Array(11).fill(1).join(':')]) expect(parseWeights(t)).toBeNull();
  });
});

describe('planSizing — custom weights', () => {
  it('splits money by the custom ratio and still caps the loss', () => {
    const r = planSizing(base({ settings: { ...base().settings, weightMode: 'custom', customWeights: [1, 1, 2], splits: 3 } }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.tranches.map((t) => t.share)).toEqual([0.25, 0.25, 0.5].map((x) => expect.closeTo(x, 9)));
    expect(r.plan.lossAtSl).toBeCloseTo(100, 9);
  });
});

describe('ratio helpers', () => {
  it('linear ratio and its short label', () => {
    expect(linearRatio(4)).toEqual([1, 2, 3, 4]);
    expect(ratioLabel(1)).toBe('1');
    expect(ratioLabel(5)).toBe('1:2:3:4:5');
    expect(ratioLabel(8)).toBe('1:2:…:8');
  });
});

describe('typed split count and weights (top-bar inputs)', () => {
  const cfg = (over: Partial<SizingSettings> = {}): SizingSettings => ({ ...DEFAULT_SIZING, ...over });

  it('split count: whole numbers 1 to 10 only', () => {
    expect(['1', ' 4 ', '10'].map(parseSplitCount)).toEqual([1, 4, 10]);
    for (const t of ['', '0', '11', '2.5', '-3', 'a', '3분할']) expect(parseSplitCount(t)).toBeNull();
  });

  it('the weights box shows the ratio in use', () => {
    expect(weightsText(cfg({ splits: 4 }))).toBe('1:2:3:4');
    expect(weightsText(cfg({ splits: 1 }))).toBe('1');
    expect(weightsText(cfg({ weightMode: 'equalRisk' }))).toBe(EQUAL_RISK_WORD);
    expect(weightsText(cfg({ weightMode: 'custom', customWeights: [20, 30, 50] }))).toBe('20:30:50');
  });

  it('reading the weights box: ratio count becomes the split count; 1:2:…:n is the linear example; 균등 is equal risk', () => {
    expect(readWeightsInput('1:1:2', 5)).toEqual({ weightMode: 'custom', customWeights: [1, 1, 2], splits: 3 });
    expect(readWeightsInput('20/30/50', 5)).toEqual({ weightMode: 'custom', customWeights: [20, 30, 50], splits: 3 });
    expect(readWeightsInput('1:2:3:4', 3)).toEqual({ weightMode: 'linear', splits: 4 });
    expect(readWeightsInput('7', 3)).toEqual({ weightMode: 'linear', splits: 1 });
    expect(readWeightsInput('손실 균등', 4)).toEqual({ weightMode: 'equalRisk', splits: 4 });
    expect(readWeightsInput('균등', 2)).toEqual({ weightMode: 'equalRisk', splits: 2 });
    for (const t of ['', '1:0', 'abc', Array(11).fill(1).join(':')]) expect(readWeightsInput(t, 3)).toBeNull();
  });

  it('changing only the split count keeps the weighting style', () => {
    expect(resizeSplits(cfg({ splits: 3 }), 5)).toMatchObject({ weightMode: 'linear', splits: 5 });
    expect(resizeSplits(cfg({ weightMode: 'equalRisk' }), 2)).toMatchObject({ weightMode: 'equalRisk', splits: 2 });
    const c = cfg({ weightMode: 'custom', customWeights: [20, 30, 50], splits: 3 });
    expect(resizeSplits(c, 4)).toMatchObject({ weightMode: 'custom', customWeights: [20, 30, 50, 50], splits: 4 });
    expect(resizeSplits(c, 2)).toMatchObject({ weightMode: 'custom', customWeights: [20, 30], splits: 2 });
    expect(resizeSplits(c, 1)).toMatchObject({ weightMode: 'linear', splits: 1, customWeights: [20, 30, 50] });
  });
});

describe('feeAtStop (fee meter under the order table)', () => {
  it('limit entries (maker 0.02%) + market stop (taker 0.055%) on the full position, as a share of the loss', () => {
    // 1만 USDT, 손실 1% = 100 USDT, 3분할 1:2:3, 손절폭 0.72% → 총 포지션 약 24,999 → 수수료 약 18.75 (손실의 18.75%)
    expect(feeAtStop({ totalNotional: 25_000, lossAtSl: 100 })).toEqual({ fee: expect.closeTo(18.75, 9), sharePct: expect.closeTo(18.75, 9) });
    const r = planSizing(base());
    if (!r.ok) throw new Error(r.reason);
    expect(feeAtStop(r.plan).fee).toBeCloseTo(r.plan.totalNotional * 0.00075, 9);
    expect(feeAtStop({ totalNotional: 0, lossAtSl: 0 }).sharePct).toBeNull();
  });

  it('Bybit VIP tiers (derivatives table): maker + taker per tier, lower tiers never cheaper', () => {
    // Bybit 도움말 파생상품 표 (메이커 / 테이커 %)
    const table: [string, number, number][] = [
      ['vip0', 0.02, 0.055],
      ['vip1', 0.018, 0.04],
      ['vip2', 0.016, 0.0375],
      ['vip3', 0.014, 0.035],
      ['vip4', 0.012, 0.032],
      ['vip5', 0.01, 0.032],
    ];
    expect(FEE_TIERS).toEqual(table.map((t) => t[0]));
    for (const [tier, maker, taker] of table) {
      const r = FEE_RATES[tier as (typeof FEE_TIERS)[number]];
      expect(r.maker * 100).toBeCloseTo(maker, 9);
      expect(r.taker * 100).toBeCloseTo(taker, 9);
      // 2.5만 USDT 포지션 → 수수료 = 2.5만 × (메이커 + 테이커)
      expect(feeAtStop({ totalNotional: 25_000, lossAtSl: 100 }, tier as (typeof FEE_TIERS)[number]).fee).toBeCloseTo(25_000 * (maker + taker) / 100, 9);
    }
    // VIP1: 2.5만 × 0.058% = 14.5 USDT → 손실 100의 14.5% (일반 18.75%보다 낮음)
    expect(feeAtStop({ totalNotional: 25_000, lossAtSl: 100 }, 'vip1').sharePct).toBeCloseTo(14.5, 9);
    const sums = FEE_TIERS.map((t) => FEE_RATES[t].maker + FEE_RATES[t].taker);
    for (let k = 1; k < sums.length; k++) expect(sums[k]).toBeLessThan(sums[k - 1]);
    expect(feeAtStop({ totalNotional: 25_000, lossAtSl: 100 }).fee).toBeCloseTo(18.75, 9); // 기본 = 일반
  });

  it('fee text and tier check', () => {
    expect(feePctText(0.00018)).toBe('0.018%');
    expect(feePctText(0.000375)).toBe('0.0375%');
    expect(feePctText(0.00055)).toBe('0.055%');
    expect(feePctText(0.0001)).toBe('0.01%');
    expect(isFeeTier('vip3')).toBe(true);
    expect(isFeeTier('vip6')).toBe(false);
    expect(isFeeTier(null)).toBe(false);
  });
});
