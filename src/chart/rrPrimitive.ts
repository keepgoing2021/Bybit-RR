import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { Side } from '../core/types';
import { computeBoxGeometry, type BoxGeometry, type CoordMapper } from './geometry';
import { THEME } from './theme';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface OverlayModel {
  side: Side;
  entry: number;
  sl: number | null;
  tp: number | null;
  startLogical: number;
  endLogical: number;
  closed: boolean;
  labels: { profit: string | null; loss: string | null; center: string; centerValid: boolean };
  /** SL 선정 캔들의 기간 [from, to) (논리 인덱스) */
  highlight: { from: number; to: number; label: string } | null;
  /** TP 선정 스윙 지점 */
  swing: { logical: number; price: number; label: string } | null;
  active: 'sl' | 'tp' | null;
}

/**
 * 손익비 박스를 그리는 시리즈 프리미티브.
 * 좌표는 매 갱신(updateAllViews: 확대·스크롤·데이터 변경)마다 시간·가격에서 다시 계산한다.
 */
export class RRBoxPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private model: OverlayModel | null = null;
  private geom: BoxGeometry | null = null;
  private drawn: BoxGeometry | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    this.views = [{ zOrder: () => 'top', renderer: () => (this.model ? renderer : null) }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<SeriesType>;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setModel(m: OverlayModel | null): void {
    this.model = m;
    if (!m) {
      this.geom = null;
      this.drawn = null;
    }
    this.requestUpdate?.();
  }

  getModel(): OverlayModel | null {
    return this.model;
  }

  updateAllViews(): void {
    this.geom = this.computeGeometry();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** 마지막으로 화면에 그린 좌표 (검증용) */
  getRenderedGeometry(): BoxGeometry | null {
    return this.model ? this.drawn : null;
  }

  mapper(): CoordMapper | null {
    const { chart, series } = this;
    if (!chart || !series) return null;
    return {
      priceToY: (p) => series.priceToCoordinate(p),
      logicalToX: (l) => chart.timeScale().logicalToCoordinate(l as Logical),
    };
  }

  /** 지금 차트 좌표로 새로 계산한 박스 좌표 */
  computeGeometry(): BoxGeometry | null {
    const m = this.model;
    const mapper = this.mapper();
    if (!m || !mapper) return null;
    return computeBoxGeometry(
      { side: m.side, entry: m.entry, sl: m.sl, tp: m.tp, startLogical: m.startLogical, endLogical: m.endLogical },
      mapper,
    );
  }

  private draw(target: DrawTarget): void {
    const m = this.model;
    const g = this.geom;
    this.drawn = g;
    if (!m || !g) return;
    const mapper = this.mapper();
    const barSpacing = this.chart?.timeScale().options().barSpacing ?? 6;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      if (m.closed) ctx.globalAlpha = 0.55;

      if (m.highlight && mapper) {
        const xa = mapper.logicalToX(m.highlight.from);
        const xb = mapper.logicalToX(m.highlight.to);
        if (xa !== null && xb !== null) {
          ctx.fillStyle = THEME.highlight;
          ctx.fillRect(xa - barSpacing / 2, 0, Math.max(xb - xa, 1), mediaSize.height);
          chip(ctx, m.highlight.label, (xa + xb) / 2 - barSpacing / 2, 16, THEME.chipDark, THEME.entry, mediaSize.width);
        }
      }

      if (g.profit) {
        ctx.fillStyle = THEME.profitFill;
        ctx.fillRect(g.profit.x, g.profit.y, g.profit.w, g.profit.h);
      }
      if (g.loss) {
        ctx.fillStyle = THEME.lossFill;
        ctx.fillRect(g.loss.x, g.loss.y, g.loss.w, g.loss.h);
      }

      hline(ctx, g.x1, g.x2, g.yEntry, THEME.entry, 1.5);
      if (g.yTp !== null) hline(ctx, g.x1, g.x2, g.yTp, THEME.profit, m.active === 'tp' ? 2.5 : 1.5);
      if (g.ySl !== null) hline(ctx, g.x1, g.x2, g.ySl, THEME.loss, m.active === 'sl' ? 2.5 : 1.5);

      if (!m.closed) {
        if (g.handles.tp) handle(ctx, g.handles.tp, THEME.profit, m.active === 'tp');
        if (g.handles.sl) handle(ctx, g.handles.sl, THEME.loss, m.active === 'sl');
      }

      if (m.swing && mapper) {
        const x = mapper.logicalToX(m.swing.logical);
        const y = mapper.priceToY(m.swing.price);
        if (x !== null && y !== null) {
          ctx.strokeStyle = THEME.profit;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.stroke();
          chip(ctx, m.swing.label, x, y - 16, THEME.chipDark, THEME.textMuted, mediaSize.width);
        }
      }

      const cx = (g.x1 + g.x2) / 2;
      const outward = (y: number) => (y < g.yEntry ? -1 : 1);
      if (m.labels.profit && g.yTp !== null) {
        const dir = outward(g.yTp);
        chip(ctx, m.labels.profit, cx, g.yTp + dir * 14, THEME.profit, THEME.chipText, mediaSize.width);
      }
      if (m.labels.loss && g.ySl !== null) {
        const dir = outward(g.ySl);
        chip(ctx, m.labels.loss, cx, g.ySl + dir * 14, THEME.loss, THEME.chipText, mediaSize.width);
      }
      chip(
        ctx,
        m.labels.center,
        cx,
        g.yEntry,
        THEME.chipDark,
        m.labels.centerValid ? THEME.text : THEME.warning,
        mediaSize.width,
        THEME.entry,
      );
      ctx.restore();
    });
  }
}

type Ctx = CanvasRenderingContext2D;

function hline(ctx: Ctx, x1: number, x2: number, y: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, Math.round(y) + 0.5);
  ctx.lineTo(x2, Math.round(y) + 0.5);
  ctx.stroke();
}

function handle(ctx: Ctx, r: { x: number; y: number; w: number; h: number }, color: string, active: boolean): void {
  ctx.fillStyle = active ? color : THEME.bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

function chip(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
  paneWidth: number,
  border?: string,
): void {
  ctx.font = `600 12px ${THEME.font}`;
  const w = ctx.measureText(text).width + 14;
  const h = 20;
  // 가운데 정렬하되 차트 영역 밖으로 잘리지 않게 안쪽으로 민다
  const left = Math.max(4, Math.min(x - w / 2, paneWidth - w - 4));
  const top = y - h / 2;
  ctx.fillStyle = bg;
  roundRect(ctx, left, top, w, h, 4);
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    roundRect(ctx, left + 0.5, top + 0.5, w - 1, h - 1, 4);
    ctx.stroke();
  }
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, left + 7, y + 0.5);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
