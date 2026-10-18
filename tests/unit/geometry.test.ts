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

describe('RR preset lines', () => {
  // 엔트리 100 (y 100), SL 98 → 1R = 20px. 1:1 y80, 1:1.3 y74, 1:1.5 y70, 1:1.7 y66, 1:2 y60, 1:2.5 y50, 1:3 y40
  const lvl = (rr: number) => ({ id: `rr-${rr}`, label: `1:${rr}`, price: 100 + 2 * rr, target: 'tp' as const });
  const presets = [1, 1.3, 1.5, 1.7, 2, 2.5, 3].map(lvl);
  const g = computeBoxGeometry({ ...longBox, presets }, mapper)!;

  it('drops lines closer than 14px to the previous one so labels never overlap', () => {
    expect(g.presets.map((p) => p.label)).toEqual(['1:1', '1:1.7', '1:2.5']);
    expect(g.presets.map((p) => p.y)).toEqual([80, 66, 50].map((y) => expect.closeTo(y, 9)));
  });

  it('shows every line when there is room', () => {
    const wide = computeBoxGeometry({ ...longBox, sl: 90, presets: [1, 1.3, 1.5].map((rr) => ({ ...lvl(rr), price: 100 + 10 * rr })) }, mapper)!;
    expect(wide.presets.map((p) => p.label)).toEqual(['1:1', '1:1.3', '1:1.5']);
  });

  it('hits a visible line within 4px inside the box span', () => {
    expect(hitTestPreset(g, 120, 68)?.id).toBe('rr-1.7');
    expect(hitTestPreset(g, 120, 73)).toBeNull();
    expect(hitTestPreset(g, 250, 66)).toBeNull();
  });

  it('the label chip at the right end is a bigger target than the line', () => {
    // 박스 x 100~200. 오른쪽 56px 안(이름표 칩)은 ±9px, 그 밖은 ±4px
    expect(hitTestPreset(g, 190, 66 - 7)?.id).toBe('rr-1.7');
    expect(hitTestPreset(g, 120, 66 - 7)).toBeNull();
  });

  it('a box without presets has none', () => {
    expect(computeBoxGeometry(longBox, mapper)!.presets).toEqual([]);
  });
});

describe('split entry lines', () => {
  it('maps each split price to a y coordinate and keeps its label', () => {
    const g = computeBoxGeometry({ ...longBox, splits: [{ price: 99.3, label: '2차 33%' }, { price: 98.7, label: '3차 50%' }] }, mapper)!;
    expect(g.splits).toEqual([
      { price: 99.3, label: '2차 33%', y: mapper.priceToY(99.3) },
      { price: 98.7, label: '3차 50%', y: mapper.priceToY(98.7) },
    ]);
    expect(computeBoxGeometry(longBox, mapper)!.splits).toEqual([]);
  });
});

describe('average entry lines per fill stage', () => {
  // 엔트리 100 (y 100), SL 90 (y 200)
  const box = { ...longBox, sl: 90 };
  it('maps each stage; the all-filled one always keeps its label, others hide labels that would overlap', () => {
    const g = computeBoxGeometry({
      ...box,
      avgLines: [
        { price: 97, label: '2차 체결 시 평단 97', short: '2차 97', final: false }, // y 130
        { price: 95.5, label: '3차 체결 시 평단 95.5', short: '3차 95.5', final: false }, // y 145 → 전부 체결(150)과 5px
        { price: 95, label: '전부 체결 시 평단 95', short: '전부 95', final: true }, // y 150
      ],
    }, mapper)!;
    expect(g.avgLines.map((a) => [a.final, a.showLabel])).toEqual([[false, true], [false, false], [true, true]]);
    expect(g.avgLines.map((a) => a.y)).toEqual([130, 145, 150].map((y) => expect.closeTo(y, 9)));
  });

  it('has none unless given', () => {
    expect(computeBoxGeometry(longBox, mapper)!.avgLines).toEqual([]);
  });
});
