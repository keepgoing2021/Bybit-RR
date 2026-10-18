import { describe, expect, it } from 'vitest';
import { distToSegment, handlesOf, hitTestDrawing, shapeOf, type DrawMapper } from '../../src/chart/drawingGeometry';
import type { Drawing } from '../../src/core/drawings';

// x = 시간(분) × 10, y = (200 − 가격) × 2, 화면 폭 500
const M = 60_000;
const m: DrawMapper = { toX: (t) => (t / M) * 10, toY: (p) => (200 - p) * 2, width: 500 };
const trend: Drawing = { id: 't', kind: 'trend', points: [{ time: 10 * M, price: 150 }, { time: 30 * M, price: 170 }] }; // (100,100)→(300,60)
const hline: Drawing = { id: 'h', kind: 'hline', points: [{ time: 20 * M, price: 120 }] }; // y 160
const fib: Drawing = { id: 'f', kind: 'fib', points: [{ time: 10 * M, price: 100 }, { time: 30 * M, price: 200 }] }; // 1 at y200, 0 at y0
const channel: Drawing = {
  id: 'c', kind: 'channel',
  points: [{ time: 10 * M, price: 150 }, { time: 30 * M, price: 150 }, { time: 20 * M, price: 140 }], // 위 y100, 아래 y120
};

describe('distToSegment', () => {
  it('perpendicular inside, endpoint distance outside', () => {
    expect(distToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
    expect(distToSegment({ x: 103, y: 4 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(5);
  });
});

describe('shapeOf', () => {
  it('trend is a segment between its two points', () => {
    expect(shapeOf(trend, m)).toEqual({ kind: 'trend', a: { x: 100, y: 100 }, b: { x: 300, y: 60 } });
  });

  it('horizontal line spans the whole width', () => {
    expect(shapeOf(hline, m)).toEqual({ kind: 'hline', y: 160, price: 120 });
  });

  it('fib levels between the two points with their prices', () => {
    const s = shapeOf(fib, m);
    if (s?.kind !== 'fib') throw new Error();
    expect(s.x1).toBe(100);
    expect(s.x2).toBe(300);
    expect(s.levels.find((l) => l.level === 0)).toEqual({ level: 0, price: 200, y: 0 });
    expect(s.levels.find((l) => l.level === 0.5)).toEqual({ level: 0.5, price: 150, y: 100 });
  });

  it('channel has the base line, the parallel line through the third point and a middle line', () => {
    const s = shapeOf(channel, m);
    if (s?.kind !== 'channel') throw new Error();
    expect(s.a).toEqual([{ x: 100, y: 100 }, { x: 300, y: 100 }]);
    expect(s.b).toEqual([{ x: 100, y: 120 }, { x: 300, y: 120 }]);
    expect(s.mid).toEqual([{ x: 100, y: 110 }, { x: 300, y: 110 }]);
  });

  it('a drawing with too few points (in progress) still shows what it has', () => {
    expect(shapeOf({ ...trend, points: [trend.points[0]] }, m)).toBeNull();
  });
});

describe('hitTestDrawing', () => {
  it('handles win over the body', () => {
    expect(handlesOf(trend, m)).toEqual([{ x: 100, y: 100 }, { x: 300, y: 60 }]);
    expect(hitTestDrawing(trend, m, 102, 103)).toEqual({ part: 'point', index: 0 });
    expect(hitTestDrawing(trend, m, 200, 83)).toEqual({ part: 'body' }); // 선 위 (y 80) 3px
    expect(hitTestDrawing(trend, m, 200, 95)).toBeNull();
  });

  it('horizontal line is hit anywhere across', () => {
    expect(hitTestDrawing(hline, m, 450, 163)).toEqual({ part: 'body' });
    expect(hitTestDrawing(hline, m, 450, 170)).toBeNull();
  });

  it('fib is hit on a level line inside its span', () => {
    expect(hitTestDrawing(fib, m, 200, 102)).toEqual({ part: 'body' }); // 0.5
    expect(hitTestDrawing(fib, m, 400, 100)).toBeNull(); // 범위 밖
  });

  it('channel is hit on its lines or inside it', () => {
    expect(hitTestDrawing(channel, m, 200, 110)).toEqual({ part: 'body' });
    expect(hitTestDrawing(channel, m, 200, 140)).toBeNull();
    expect(hitTestDrawing(channel, m, 200, 121)).toEqual({ part: 'point', index: 2 }); // 셋째 점(200,120)
  });
});
