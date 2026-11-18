import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { PullbackSignal } from '../core/pullback';
import type { DrawMapper } from './drawingGeometry';
import { THEME } from './theme';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** 눌림 알림 신호 표시 (2026-11-18): 롱은 봉 아래 초록 ▲, 숏은 봉 위 빨강 ▼ + 「눌림」 */
export class PullbackPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private signals: readonly PullbackSignal[] = [];
  private readonly views: readonly IPrimitivePaneView[];

  constructor(private readonly mapper: () => DrawMapper | null) {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    this.views = [{ zOrder: () => 'normal', renderer: () => renderer }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  set(signals: readonly PullbackSignal[]): void {
    this.signals = signals;
    this.requestUpdate?.();
  }

  get(): readonly PullbackSignal[] {
    return this.signals;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: DrawTarget): void {
    const m = this.mapper();
    if (!m || !this.signals.length) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `700 10px ${THEME.font}`;
      for (const s of this.signals) {
        const x = m.toX(s.time);
        const y = m.toY(s.price);
        if (x === null || y === null) continue;
        const long = s.dir === 'long';
        ctx.fillStyle = long ? THEME.profit : THEME.loss;
        // 꼬리 끝에서 6px 떨어진 삼각형 (8px)
        const tip = long ? y + 6 : y - 6;
        const base = long ? tip + 8 : tip - 8;
        ctx.beginPath();
        ctx.moveTo(x, tip);
        ctx.lineTo(x - 5, base);
        ctx.lineTo(x + 5, base);
        ctx.closePath();
        ctx.fill();
        ctx.textBaseline = long ? 'top' : 'bottom';
        ctx.fillText('눌림', x, long ? base + 2 : base - 2);
      }
      ctx.restore();
    });
  }
}
