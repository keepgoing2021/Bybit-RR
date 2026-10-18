import { channelOffset, fibLevels, POINTS, type Drawing } from '../core/drawings';

export interface Px {
  x: number;
  y: number;
}

/** 시간·가격 → 화면 좌표 */
export interface DrawMapper {
  toX(time: number): number | null;
  toY(price: number): number | null;
  /** 차트 영역 폭 (수평선이 끝까지 간다) */
  width: number;
}

export type Shape =
  | { kind: 'trend'; a: Px; b: Px }
  | { kind: 'hline'; y: number; price: number }
  | { kind: 'channel'; a: [Px, Px]; b: [Px, Px]; mid: [Px, Px] }
  | { kind: 'fib'; x1: number; x2: number; a: Px; b: Px; levels: { level: number; price: number; y: number }[] };

const HANDLE_TOL = 7;
const LINE_TOL = 6;

function px(m: DrawMapper, time: number, price: number): Px | null {
  const x = m.toX(time);
  const y = m.toY(price);
  return x === null || y === null ? null : { x, y };
}

/** 화면에 그릴 모양. 점이 모자라거나 좌표를 못 구하면 null */
export function shapeOf(d: Drawing, m: DrawMapper): Shape | null {
  if (d.points.length < POINTS[d.kind]) return null;
  const [p1, p2, p3] = d.points;
  if (d.kind === 'hline') {
    const y = m.toY(p1.price);
    return y === null ? null : { kind: 'hline', y, price: p1.price };
  }
  const a = px(m, p1.time, p1.price);
  const b = px(m, p2.time, p2.price);
  if (!a || !b) return null;
  if (d.kind === 'trend') return { kind: 'trend', a, b };
  if (d.kind === 'fib') {
    const levels = fibLevels(p1, p2).flatMap((l) => {
      const y = m.toY(l.price);
      return y === null ? [] : [{ ...l, y }];
    });
    return { kind: 'fib', x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), a, b, levels };
  }
  const off = channelOffset(p1, p2, p3);
  const a2 = px(m, p1.time, p1.price + off);
  const b2 = px(m, p2.time, p2.price + off);
  const am = px(m, p1.time, p1.price + off / 2);
  const bm = px(m, p2.time, p2.price + off / 2);
  if (!a2 || !b2 || !am || !bm) return null;
  return { kind: 'channel', a: [a, b], b: [a2, b2], mid: [am, bm] };
}

/** 끌어서 고칠 수 있는 점 (화면 좌표). 수평선은 찍은 자리 */
export function handlesOf(d: Drawing, m: DrawMapper): Px[] {
  return d.points.flatMap((p) => {
    const q = px(m, p.time, p.price);
    return q ? [q] : [];
  });
}

export function distToSegment(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 같은 x에서 선분 위 y (선분 x 범위 밖이면 null) */
function yAt(seg: [Px, Px], x: number): number | null {
  const [a, b] = seg;
  if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) return null;
  if (a.x === b.x) return a.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** 끝점(우선) 또는 몸통이 눌렸는지 */
export function hitTestDrawing(d: Drawing, m: DrawMapper, x: number, y: number): { part: 'point'; index: number } | { part: 'body' } | null {
  const p = { x, y };
  const handles = handlesOf(d, m);
  let best = -1;
  let bestD = Infinity;
  handles.forEach((h, i) => {
    const dist = Math.hypot(h.x - x, h.y - y);
    if (dist <= HANDLE_TOL && dist < bestD) {
      best = i;
      bestD = dist;
    }
  });
  if (best >= 0) return { part: 'point', index: best };

  const s = shapeOf(d, m);
  if (!s) return null;
  const near = (a: Px, b: Px) => distToSegment(p, a, b) <= LINE_TOL;
  switch (s.kind) {
    case 'trend':
      return near(s.a, s.b) ? { part: 'body' } : null;
    case 'hline':
      return Math.abs(y - s.y) <= LINE_TOL ? { part: 'body' } : null;
    case 'fib': {
      if (near(s.a, s.b)) return { part: 'body' };
      if (x < s.x1 - LINE_TOL || x > s.x2 + LINE_TOL) return null;
      return s.levels.some((l) => Math.abs(y - l.y) <= LINE_TOL) ? { part: 'body' } : null;
    }
    case 'channel': {
      if (near(...s.a) || near(...s.b) || near(...s.mid)) return { part: 'body' };
      const ya = yAt(s.a, x);
      const yb = yAt(s.b, x);
      if (ya === null || yb === null) return null;
      return y >= Math.min(ya, yb) && y <= Math.max(ya, yb) ? { part: 'body' } : null;
    }
  }
}
