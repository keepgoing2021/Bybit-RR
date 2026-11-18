import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { PullbackSignal } from '../core/pullback';
import type { DrawMapper } from './drawingGeometry';
import { THEME } from './theme';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** 눌림 알림 신호 표시 (2026-11-18 사용자 요청): 눌림 구간을 테두리 상자로 — 매수 위주 초록, 매도 위주 빨강 */
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
        const x1 = m.toX(s.fromTime);
        const x2 = m.toX(s.time);
        const yTop = m.toY(s.high);
        const yBot = m.toY(s.low);
        if (x1 === null || x2 === null || yTop === null || yBot === null) continue;
        const long = s.dir === 'long';
        const color = long ? THEME.profit : THEME.loss;
        // 눌림 구간(파동 첫 봉 ~ 신호 봉)을 테두리 상자로: 매수 위주 초록, 매도 위주 빨강
        const left = Math.round(x1 - 6) + 0.5;
        const right = Math.round(x2 + 6) + 0.5;
        const top = Math.round(yTop - 5) + 0.5;
        const bottom = Math.round(yBot + 5) + 0.5;
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = color;
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(left, top, right - left, bottom - top, 4);
        ctx.stroke();
        // 이름표: 매수는 상자 아래, 매도는 상자 위
        ctx.fillStyle = color;
        ctx.textBaseline = long ? 'top' : 'bottom';
        ctx.fillText(long ? '눌림 매수 ▲' : '눌림 매도 ▼', (left + right) / 2, long ? bottom + 3 : top - 3);
      }
      ctx.restore();
    });
  }
}
