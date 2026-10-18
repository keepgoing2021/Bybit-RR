import type { PresetLevel } from '../core/presets';
import type { Side } from '../core/types';

export interface CoordMapper {
  priceToY(price: number): number | null;
  logicalToX(logical: number): number | null;
}

export interface BoxInput {
  side: Side;
  entry: number;
  sl: number | null;
  tp: number | null;
  /** 박스 왼쪽 끝 (시나리오 생성 봉의 논리 인덱스) */
  startLogical: number;
  /** 박스 오른쪽 끝 (최신 봉 + 연장 봉 수) */
  endLogical: number;
  /** ±% 점선 (누르면 그 가격으로 SL/TP 설정) */
  presets?: PresetLevel[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoxGeometry {
  x1: number;
  x2: number;
  yEntry: number;
  ySl: number | null;
  yTp: number | null;
  /** 엔트리 ~ TP (반투명 초록) */
  profit: Rect | null;
  /** 엔트리 ~ SL (반투명 빨강) */
  loss: Rect | null;
  handles: { sl: Rect | null; tp: Rect | null };
  presets: (PresetLevel & { y: number })[];
}

export const HANDLE_SIZE = 10;

/**
 * 시간·가격 좌표로 정의된 박스를 현재 화면 좌표로 바꾼다.
 * 확대·스크롤 때마다 다시 호출되므로 도형은 항상 같은 시간·가격에 붙어 있다.
 */
export function computeBoxGeometry(i: BoxInput, m: CoordMapper): BoxGeometry | null {
  const xa = m.logicalToX(i.startLogical);
  const xb = m.logicalToX(i.endLogical);
  const yEntry = m.priceToY(i.entry);
  if (xa === null || xb === null || yEntry === null) return null;
  const x1 = Math.min(xa, xb);
  const x2 = Math.max(xa, xb);
  const ySl = i.sl === null ? null : m.priceToY(i.sl);
  const yTp = i.tp === null ? null : m.priceToY(i.tp);

  const band = (y: number | null): Rect | null =>
    y === null ? null : { x: x1, y: Math.min(y, yEntry), w: x2 - x1, h: Math.abs(y - yEntry) };
  const handle = (y: number | null): Rect | null =>
    y === null ? null : { x: x1 - HANDLE_SIZE / 2, y: y - HANDLE_SIZE / 2, w: HANDLE_SIZE, h: HANDLE_SIZE };

  return {
    x1,
    x2,
    yEntry,
    ySl,
    yTp,
    profit: band(yTp),
    loss: band(ySl),
    handles: { sl: handle(ySl), tp: handle(yTp) },
    presets: (i.presets ?? []).flatMap((p) => {
      const y = m.priceToY(p.price);
      return y === null ? [] : [{ ...p, y }];
    }),
  };
}

/** 박스 가로 범위 안에서 ±% 점선 위인지 (가장 가까운 것) */
export function hitTestPreset(g: BoxGeometry, x: number, y: number, tol = 4): (PresetLevel & { y: number }) | null {
  if (x < g.x1 || x > g.x2) return null;
  let best: (PresetLevel & { y: number }) | null = null;
  for (const p of g.presets) {
    const d = Math.abs(p.y - y);
    if (d <= tol && (!best || d < Math.abs(best.y - y))) best = p;
  }
  return best;
}

/** SL·TP 선(박스 가로 범위 안) 또는 핸들 위인지. 둘 다 가까우면 더 가까운 쪽. */
export function hitTest(g: BoxGeometry, x: number, y: number, tol = 6): 'sl' | 'tp' | null {
  let best: { which: 'sl' | 'tp'; dist: number } | null = null;
  const consider = (which: 'sl' | 'tp', ly: number | null, h: Rect | null) => {
    if (ly === null) return;
    let dist = Infinity;
    if (h && x >= h.x - 2 && x <= h.x + h.w + 2 && y >= h.y - 2 && y <= h.y + h.h + 2) dist = Math.abs(y - ly);
    else if (x >= g.x1 - tol && x <= g.x2 + tol && Math.abs(y - ly) <= tol) dist = Math.abs(y - ly);
    if (dist !== Infinity && (!best || dist < best.dist)) best = { which, dist };
  };
  consider('sl', g.ySl, g.handles.sl);
  consider('tp', g.yTp, g.handles.tp);
  return best === null ? null : (best as { which: 'sl' | 'tp' }).which;
}
