import { hitTest, type BoxGeometry } from './geometry';

export type DragTarget = 'sl' | 'tp';

export interface DragDeps {
  getGeometry(): BoxGeometry | null;
  yToPrice(y: number): number | null;
  snap(price: number): number;
  /** 드래그 중 매 이동마다 호출 (가격은 호가 단위로 맞춘 값) */
  onDrag(which: DragTarget, price: number): void;
  onDragEnd?(which: DragTarget): void;
  /** 드래그 동안 차트 이동·확대를 끄고, 놓으면 다시 켠다 */
  setChartInteraction(enabled: boolean): void;
  tolerance?: number;
}

/**
 * SL·TP 선 드래그. 차트 라이브러리와 무관한 순수 로직이라 단위 테스트한다.
 * 잡은 선 하나만 바꾸고 반대쪽 선은 건드리지 않는다.
 */
export class DragController {
  private target: DragTarget | null = null;

  constructor(private readonly d: DragDeps) {}

  pointerDown(x: number, y: number): boolean {
    const g = this.d.getGeometry();
    if (!g) return false;
    const hit = hitTest(g, x, y, this.d.tolerance);
    if (!hit) return false;
    this.target = hit;
    this.d.setChartInteraction(false);
    return true;
  }

  pointerMove(_x: number, y: number): void {
    if (!this.target) return;
    const price = this.d.yToPrice(y);
    if (price === null || !Number.isFinite(price)) return;
    this.d.onDrag(this.target, this.d.snap(price));
  }

  pointerUp(): void {
    if (!this.target) return;
    const t = this.target;
    this.target = null;
    this.d.setChartInteraction(true);
    this.d.onDragEnd?.(t);
  }

  isDragging(): boolean {
    return this.target !== null;
  }

  hover(x: number, y: number): DragTarget | null {
    const g = this.d.getGeometry();
    return g ? hitTest(g, x, y, this.d.tolerance) : null;
  }
}

export interface BoxMoveDeps {
  getGeometry(): BoxGeometry | null;
  xToLogical(x: number): number | null;
  /** 현재 박스 이동량 (봉 단위, 0 이상) */
  getShiftBars(): number;
  onMove(shiftBars: number): void;
  onMoveEnd(shiftBars: number): void;
  setChartInteraction(enabled: boolean): void;
  /** 이 이상 옮기면 박스가 화면 밖으로 나간다 (없으면 제한 없음) */
  maxShiftBars?(): number | null;
}

/** 박스 몸통(수익·손실 영역)이 눌렸는지 */
export function insideBoxBody(g: BoxGeometry, x: number, y: number): boolean {
  if (x < g.x1 || x > g.x2) return false;
  const ys = [g.yEntry - 6, g.yEntry + 6];
  for (const r of [g.profit, g.loss]) if (r) ys.push(r.y, r.y + r.h);
  return y >= Math.min(...ys) && y <= Math.max(...ys);
}

/**
 * 박스 좌우 이동. 가격(엔트리·SL·TP)은 건드리지 않고 그리는 위치만 봉 단위로 옮긴다.
 * 엔트리 시점보다 왼쪽(음수)으로는 옮기지 않는다.
 */
export class BoxMoveController {
  private start: { logical: number; shift: number; max: number } | null = null;
  private last = 0;

  constructor(private readonly d: BoxMoveDeps) {}

  pointerDown(x: number, y: number): boolean {
    const g = this.d.getGeometry();
    if (!g || !insideBoxBody(g, x, y)) return false;
    const logical = this.d.xToLogical(x);
    if (logical === null) return false;
    const shift = this.d.getShiftBars();
    this.start = { logical, shift, max: Math.max(shift, this.d.maxShiftBars?.() ?? Infinity) };
    this.last = this.start.shift;
    this.d.setChartInteraction(false);
    return true;
  }

  pointerMove(x: number, _y: number): void {
    if (!this.start) return;
    const logical = this.d.xToLogical(x);
    if (logical === null) return;
    const next = Math.min(this.start.max, Math.max(0, this.start.shift + Math.round(logical - this.start.logical)));
    if (next === this.last) return;
    this.last = next;
    this.d.onMove(next);
  }

  pointerUp(): void {
    if (!this.start) return;
    this.start = null;
    this.d.setChartInteraction(true);
    this.d.onMoveEnd(this.last);
  }

  isMoving(): boolean {
    return this.start !== null;
  }

  hover(x: number, y: number): boolean {
    const g = this.d.getGeometry();
    return !!g && insideBoxBody(g, x, y);
  }
}
