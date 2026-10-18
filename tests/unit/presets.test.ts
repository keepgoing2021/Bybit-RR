import { describe, expect, it } from 'vitest';
import { parseRR, RR_LEVELS, rrLevels, tpForRR } from '../../src/core/presets';

describe('tpForRR', () => {
  it('puts TP at entry ± RR × (entry − SL distance), snapped to the tick', () => {
    expect(tpForRR('LONG', 100, 98, 1.5, 0.01)).toBe(103);
    expect(tpForRR('SHORT', 100, 102, 1.5, 0.01)).toBe(97);
    expect(tpForRR('LONG', 4156.23, 3942, 1.3, 0.01)).toBe(4434.73); // 4156.23 + 1.3 × 214.23 = 4434.729
  });

  it('needs an SL on the losing side and a positive RR', () => {
    expect(tpForRR('LONG', 100, null, 1.5, 0.01)).toBeNull();
    expect(tpForRR('LONG', 100, 101, 1.5, 0.01)).toBeNull();
    expect(tpForRR('SHORT', 100, 99, 1.5, 0.01)).toBeNull();
    expect(tpForRR('LONG', 100, 98, 0, 0.01)).toBeNull();
  });
});

describe('rrLevels', () => {
  it('offers 1:1 to 1:3 lines that set TP', () => {
    expect(RR_LEVELS).toEqual([1, 1.3, 1.5, 1.7, 2, 2.5, 3]);
    const r = rrLevels('LONG', 100, 98, 0.01);
    expect(r.map((p) => p.label)).toEqual(['1:1', '1:1.3', '1:1.5', '1:1.7', '1:2', '1:2.5', '1:3']);
    expect(r.map((p) => p.price)).toEqual([102, 102.6, 103, 103.4, 104, 105, 106]);
    expect(new Set(r.map((p) => p.target))).toEqual(new Set(['tp']));
    expect(new Set(r.map((p) => p.id)).size).toBe(7);
  });

  it('SHORT goes downward', () => {
    expect(rrLevels('SHORT', 100, 102, 0.01)[0].price).toBe(98);
  });

  it('has no lines without a valid SL', () => {
    expect(rrLevels('LONG', 100, null, 0.01)).toEqual([]);
    expect(rrLevels('LONG', 100, 100.5, 0.01)).toEqual([]);
  });
});

describe('parseRR', () => {
  it('accepts 1.5, 1:1.5 and spaces', () => {
    expect(parseRR('1.5')).toBe(1.5);
    expect(parseRR('1:1.5')).toBe(1.5);
    expect(parseRR(' 1 : 2 ')).toBe(2);
  });

  it('rejects empty, zero, negative and text', () => {
    for (const t of ['', '0', '-1', 'abc', '1:']) expect(parseRR(t)).toBeNull();
  });
});
