import { describe, expect, it } from 'vitest';
import { presetLevels } from '../../src/core/presets';

describe('presetLevels', () => {
  it('LONG: plus levels set TP, minus levels set SL', () => {
    expect(presetLevels('LONG', 100, 0.01)).toEqual([
      { pct: 5, price: 105, target: 'tp' },
      { pct: 3, price: 103, target: 'tp' },
      { pct: 1, price: 101, target: 'tp' },
      { pct: -1, price: 99, target: 'sl' },
      { pct: -3, price: 97, target: 'sl' },
      { pct: -5, price: 95, target: 'sl' },
    ]);
  });

  it('SHORT: minus levels set TP, plus levels set SL', () => {
    const r = presetLevels('SHORT', 100, 0.01);
    expect(r.find((p) => p.pct === 1)).toEqual({ pct: 1, price: 101, target: 'sl' });
    expect(r.find((p) => p.pct === -3)).toEqual({ pct: -3, price: 97, target: 'tp' });
  });

  it('snaps to the tick size', () => {
    const r = presetLevels('LONG', 2407.36, 0.01);
    expect(r.find((p) => p.pct === 1)!.price).toBe(2431.43);
    expect(r.find((p) => p.pct === -5)!.price).toBe(2286.99);
  });
});
