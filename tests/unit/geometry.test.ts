import { describe, expect, it } from 'vitest';
import { computeBoxGeometry, hitTest, hitTestPreset, type BoxInput, type CoordMapper } from '../../src/chart/geometry';

// y = (110 − 가격) × 10, x = 논리 인덱스 × 10
const mapper: CoordMapper = {
  priceToY: (p) => (110 - p) * 10,
  logicalToX: (l) => l * 10,
};

const longBox: BoxInput = { side: 'LONG', entry: 100, sl: 98, tp: 106, startLogical: 10, endLogical: 20 };

describe('computeBoxGeometry', () => {
  it('LONG profit sits above entry and loss below', () => {
    const g = computeBoxGeometry(longBox, mapper)!;
    expect([g.x1, g.x2, g.yEntry, g.ySl, g.yTp]).toEqual([100, 200, 100, 120, 40]);
    expect(g.profit).toEqual({ x: 100, y: 40, w: 100, h: 60 });
    expect(g.loss).toEqual({ x: 100, y: 100, w: 100, h: 20 });
  });

  it('SHORT profit sits below entry and loss above', () => {
    const g = computeBoxGeometry({ ...longBox, side: 'SHORT', sl: 102, tp: 94 }, mapper)!;
    expect(g.profit).toEqual({ x: 100, y: 100, w: 100, h: 60 });
    expect(g.loss).toEqual({ x: 100, y: 80, w: 100, h: 20 });
  });

  it('missing SL leaves no loss area and no SL handle', () => {
    const g = computeBoxGeometry({ ...longBox, sl: null }, mapper)!;
    expect(g.loss).toBeNull();
    expect(g.ySl).toBeNull();
    expect(g.handles.sl).toBeNull();
    expect(g.handles.tp).not.toBeNull();
  });

  it('returns null when a coordinate cannot be resolved', () => {
    expect(computeBoxGeometry(longBox, { ...mapper, logicalToX: () => null })).toBeNull();
    expect(computeBoxGeometry(longBox, { ...mapper, priceToY: () => null })).toBeNull();
  });
});

describe('hitTest', () => {
  const g = computeBoxGeometry(longBox, mapper)!;

  it('hits a line within the tolerance inside the box span', () => {
    expect(hitTest(g, 150, 124)).toBe('sl');
    expect(hitTest(g, 150, 37)).toBe('tp');
    expect(hitTest(g, 95, 120)).toBe('sl');
  });

  it('misses outside the tolerance or the box span', () => {
    expect(hitTest(g, 150, 127)).toBeNull();
    expect(hitTest(g, 250, 120)).toBeNull();
    expect(hitTest(g, 150, 100)).toBeNull(); // 엔트리선은 드래그 대상 아님
  });

  it('hits the handle square', () => {
    expect(g.handles.sl).toEqual({ x: 95, y: 115, w: 10, h: 10 });
    expect(hitTest(g, 104, 116)).toBe('sl');
  });

  it('nearest line wins when both are in range', () => {
    const close = computeBoxGeometry({ ...longBox, tp: 99, sl: 98 }, mapper)!; // tp y 110, sl y 120
    expect(hitTest(close, 150, 114)).toBe('tp');
    expect(hitTest(close, 150, 116)).toBe('sl');
  });
});

describe('percent preset lines', () => {
  const presets = [
    { pct: 3, price: 103, target: 'tp' as const },
    { pct: -1, price: 99, target: 'sl' as const },
  ];
  const g = computeBoxGeometry({ ...longBox, presets }, mapper)!;

  it('places each preset at its price inside the box', () => {
    expect(g.presets).toEqual([
      { pct: 3, price: 103, target: 'tp', y: 70 },
      { pct: -1, price: 99, target: 'sl', y: 110 },
    ]);
  });

  it('hits a preset line within 4px inside the box span', () => {
    expect(hitTestPreset(g, 150, 72)?.pct).toBe(3);
    expect(hitTestPreset(g, 150, 107)?.pct).toBe(-1);
    expect(hitTestPreset(g, 150, 75)).toBeNull();
    expect(hitTestPreset(g, 250, 70)).toBeNull();
  });

  it('a box without presets has none', () => {
    expect(computeBoxGeometry(longBox, mapper)!.presets).toEqual([]);
  });
});
