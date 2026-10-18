import { describe, expect, it } from 'vitest';
import { findSwings } from '../../src/core/swing';
import { fromHighs, fromLows, MIN } from './helpers/candles';

describe('findSwings', () => {
  it('marks the first of two equal highs as the pivot (left strict, right inclusive)', () => {
    const highs = findSwings(fromHighs([1, 2, 5, 5, 3, 2]), 2).filter((s) => s.kind === 'high');
    expect(highs.map((s) => s.index)).toEqual([2]);
    expect(highs[0].price).toBe(5);
    expect(highs[0].confirmIndex).toBe(4);
    expect(highs[0].time).toBe(2 * MIN);
  });

  it('never marks the last `bars` candles because their right side is not known yet', () => {
    const highs = findSwings(fromHighs([1, 2, 3, 4, 9, 1]), 2).filter((s) => s.kind === 'high');
    expect(highs).toEqual([]);
  });

  it('finds swing lows symmetrically', () => {
    const lows = findSwings(fromLows([9, 8, 3, 3, 6, 7]), 2).filter((s) => s.kind === 'low');
    expect(lows.map((s) => s.index)).toEqual([2]);
    expect(lows[0].price).toBe(3);
  });

  it('uses the configured number of bars on each side', () => {
    const c = fromHighs([1, 5, 2, 8, 3, 4, 1]);
    expect(findSwings(c, 1).filter((s) => s.kind === 'high').map((s) => s.index)).toEqual([1, 3, 5]);
    expect(findSwings(c, 3).filter((s) => s.kind === 'high').map((s) => s.index)).toEqual([3]);
  });
});
