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
