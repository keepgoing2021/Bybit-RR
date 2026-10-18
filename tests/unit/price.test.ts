import { describe, expect, it } from 'vitest';
import { decimalsOf, formatPrice, snapToTick, ticksBetween } from '../../src/core/price';

describe('decimalsOf', () => {
  it('counts decimal places of a tick size', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(0.0001)).toBe(4);
  });

  it('decimalsOf handles 1e-7', () => {
    expect(decimalsOf(1e-7)).toBe(7);
    expect(decimalsOf(0.0000001)).toBe(7);
  });
});

describe('snapToTick', () => {
  it('rounds to the nearest tick', () => {
    expect(snapToTick(97.33, 0.5)).toBe(97.5);
    expect(snapToTick(97.2, 0.5)).toBe(97);
  });

  it('returns an exact decimal without float noise', () => {
    expect(snapToTick(97.3, 0.1)).toBe(97.3);
    expect(snapToTick(0.30000000000000004, 0.1)).toBe(0.3);
    expect(snapToTick(0.00012345678, 1e-7)).toBe(0.0001235);
  });
});

describe('ticksBetween', () => {
  it('counts whole ticks between two prices', () => {
    expect(ticksBetween(100, 97, 0.1)).toBe(30);
    expect(ticksBetween(97, 100, 0.1)).toBe(30);
    expect(ticksBetween(125.6, 81.98, 0.01)).toBe(4362);
  });
});

describe('formatPrice', () => {
  it('prints exactly the tick precision', () => {
    expect(formatPrice(1234.5, 0.01)).toBe('1234.50');
    expect(formatPrice(0.0001235, 1e-7)).toBe('0.0001235');
    expect(formatPrice(65000, 0.1)).toBe('65000.0');
  });
});
