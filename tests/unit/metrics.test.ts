import { describe, expect, it } from 'vitest';
import { computeMetrics, formatRR } from '../../src/core/metrics';

const base = { tickSize: 0.01, current: null as number | null };

describe('computeMetrics — spec examples', () => {
  it('LONG 100/98/106 gives RR 1:3', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 98, tp: 106 });
    expect(m.valid).toBe(true);
    expect(m.rr).toBe(3);
    expect(m.riskDist).toBe(2);
    expect(m.rewardDist).toBe(6);
    expect(m.riskPct).toBeCloseTo(2, 10);
    expect(m.rewardPct).toBeCloseTo(6, 10);
    expect(m.riskTicks).toBe(200);
    expect(m.rewardTicks).toBe(600);
  });

  it('LONG with SL moved to 97 gives RR 1:2', () => {
    expect(computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 97, tp: 106 }).rr).toBe(2);
  });

  it('LONG with TP moved to 109 gives RR 1:3', () => {
    expect(computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 97, tp: 109 }).rr).toBe(3);
  });

  it('SHORT 100/102/94 gives RR 1:3', () => {
    const m = computeMetrics({ ...base, side: 'SHORT', entry: 100, sl: 102, tp: 94 });
    expect(m.valid).toBe(true);
    expect(m.rr).toBe(3);
  });

  it('matches the reference image numbers', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 81.98, sl: 53.39, tp: 125.6 });
    expect(m.rewardTicks).toBe(4362);
    expect(m.riskTicks).toBe(2859);
    expect(formatRR(m.rr!)).toBe('1:1.53');
    expect(m.rewardPct!).toBeCloseTo(53.208, 3);
    expect(m.riskPct!).toBeCloseTo(34.874, 3);
  });
});

describe('computeMetrics — current price', () => {
  it('LONG current R and return follow price direction', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 98, tp: 106, current: 101 });
    expect(m.currentR).toBe(0.5);
    expect(m.currentPct).toBeCloseTo(1, 10);
  });

  it('SHORT current R and return are positive when price falls', () => {
    const m = computeMetrics({ ...base, side: 'SHORT', entry: 100, sl: 102, tp: 94, current: 99 });
    expect(m.currentR).toBe(0.5);
    expect(m.currentPct).toBeCloseTo(1, 10);
  });

  it('current R is available even when TP is missing', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 98, tp: null, current: 97 });
    expect(m.currentR).toBe(-1.5);
    expect(m.rr).toBeNull();
  });
});

describe('computeMetrics — invalid states', () => {
  it('missing SL is reported and RR is not shown', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 100, sl: null, tp: 106 });
    expect(m.valid).toBe(false);
    expect(m.rr).toBeNull();
    expect(m.reasons.join(' ')).toContain('SL 미설정');
    expect(m.rewardPct).toBeCloseTo(6, 10);
  });

  it('missing TP is reported', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 98, tp: null });
    expect(m.reasons.join(' ')).toContain('TP 미설정');
  });

  it('SL equal to entry means zero risk', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 100, tp: 106 });
    expect(m.valid).toBe(false);
    expect(m.rr).toBeNull();
    expect(m.currentR).toBeNull();
    expect(m.reasons.join(' ')).toContain('위험 거리가 0');
  });

  it('LONG TP below entry is invalid', () => {
    const m = computeMetrics({ ...base, side: 'LONG', entry: 100, sl: 98, tp: 99 });
    expect(m.valid).toBe(false);
    expect(m.reasons.join(' ')).toContain('TP는 엔트리보다 높아야');
  });

  it('SHORT SL below entry is invalid and has no current R', () => {
    const m = computeMetrics({ ...base, side: 'SHORT', entry: 100, sl: 99, tp: 94, current: 98 });
    expect(m.valid).toBe(false);
    expect(m.reasons.join(' ')).toContain('SL은 엔트리보다 높아야');
    expect(m.currentR).toBeNull();
    expect(m.currentPct).toBeCloseTo(2, 10);
  });
});

describe('formatRR', () => {
  it('drops trailing zeros and keeps two decimals', () => {
    expect(formatRR(3)).toBe('1:3');
    expect(formatRR(1.5257)).toBe('1:1.53');
    expect(formatRR(2.5)).toBe('1:2.5');
  });
});
