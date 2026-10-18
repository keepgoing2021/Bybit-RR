import { describe, expect, it } from 'vitest';
import { computeBoxGeometry, hitTest, hitTestPreset, NARROW_BOX, type BoxInput, type CoordMapper } from '../../src/chart/geometry';

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
  // 넓은 박스 x 100~400 (너비 300) / longBox는 x 100~200 (너비 100, 좁음). 엔트리 100 = y 100, 0.1원 = 1px
  const wide = { ...longBox, endLogical: 40 };

  it('maps each split price to a y coordinate and keeps its label', () => {
    const g = computeBoxGeometry({ ...wide, splits: [{ price: 98.5, label: '2차 33%' }, { price: 97, label: '3차 50%' }] }, mapper)!;
    expect(g.splits).toEqual([
      { price: 98.5, label: '2차 33%', y: mapper.priceToY(98.5), showLabel: true },
      { price: 97, label: '3차 50%', y: mapper.priceToY(97), showLabel: true },
    ]);
    expect(computeBoxGeometry(longBox, mapper)!.splits).toEqual([]);
  });

  const many = [99.5, 99, 98.5, 98, 97.5, 97].map((price, k) => ({ price, label: `${k + 2}차` })); // y 105 ~ 130, 5px 간격

  it('many splits in a wide box: every line stays, labels closer than 14px to the entry or the last shown label are hidden', () => {
    const g = computeBoxGeometry({ ...wide, splits: many }, mapper)!;
    expect(g.splits).toHaveLength(6);
    expect(g.splits.map((x) => x.showLabel)).toEqual([false, false, true, false, false, true]);
  });

  it('in a narrow box split labels also keep clear of the entry RR chip and the average chips', () => {
    expect(NARROW_BOX).toBeGreaterThan(100);
    // 이름표 중심(선 − 7)이 엔트리(100)에서 17px 이상: y 125부터
    const g = computeBoxGeometry({ ...longBox, splits: many }, mapper)!;
    expect(g.splits.map((x) => x.showLabel)).toEqual([false, false, false, false, true, false]);
    // 평단 칩(y 145) 바로 아래 분할(y 150, 이름표 중심 143)은 이름표를 숨긴다. 넓은 박스면 보인다
    const withAvg = {
      splits: [{ price: 97, label: '2차' }, { price: 95, label: '3차' }],
      avgLines: [{ price: 95.5, label: '전부 체결 시 평단 95.5', short: '전부 95.5', final: true }],
    };
    expect(computeBoxGeometry({ ...longBox, sl: 90, ...withAvg }, mapper)!.splits.map((x) => x.showLabel)).toEqual([true, false]);
    expect(computeBoxGeometry({ ...wide, sl: 90, ...withAvg }, mapper)!.splits.map((x) => x.showLabel)).toEqual([true, true]);
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

  it('a stage average right next to the entry hides its label (the RR chip sits there); the all-filled one always shows', () => {
    const g = computeBoxGeometry({
      ...box,
      avgLines: [
        { price: 98.5, label: '2차 체결 시 평단 98.5', short: '2차 98.5', final: false }, // y 115 → 엔트리와 15px
        { price: 95, label: '전부 체결 시 평단 95', short: '전부 95', final: true }, // y 150
      ],
    }, mapper)!;
    expect(g.avgLines.map((a) => a.showLabel)).toEqual([false, true]);
  });

  it('has none unless given', () => {
    expect(computeBoxGeometry(longBox, mapper)!.avgLines).toEqual([]);
  });
});
