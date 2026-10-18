import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { POINTS, type Anchor, type Drawing, type DrawingKind } from '../core/drawings';
import { handlesOf, shapeOf, type DrawMapper, type Px, type Shape } from './drawingGeometry';
import { THEME } from './theme';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];
type Ctx = CanvasRenderingContext2D;

/** 작도 기본 색 (손익·엔트리·이동평균·평단 색과 겹치지 않는 청록) */
export const DRAW_COLOR = '#26C6DA';
/** 모든 작도 선 굵기 (가장 얇게). 선택은 끝점 동그라미로만 표시 */
export const DRAW_LINE_WIDTH = 1;

/** 피보나치 레벨 색 (TradingView 기본과 비슷하게) */
const FIB_COLORS: Record<string, string> = {
  '0': '#9598A1',
  '0.236': '#F23645',
  '0.382': '#FF9800',
  '0.5': '#4CAF50',
  '0.618': '#089981',
  '0.786': '#00BCD4',
  '1': '#9598A1',
};

export interface DrawingsModel {
  drawings: Drawing[];
  selectedId: string | null;
  hoverId: string | null;
  /** 그리는 중: 찍은 점 + 마우스 위치 (미리 보기) */
  draft: { kind: DrawingKind; points: Anchor[]; color?: string } | null;
}

/** 작도 그리기 (차트 위, 손익비 박스 아래) */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private model: DrawingsModel = { drawings: [], selectedId: null, hoverId: null, draft: null };
  private readonly views: readonly IPrimitivePaneView[];

  constructor(
    private readonly mapper: () => DrawMapper | null,
    private readonly format: (price: number) => string,
  ) {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    this.views = [{ zOrder: () => 'top', renderer: () => renderer }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  set(m: DrawingsModel): void {
    this.model = m;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** 수평선 가격 라벨 (오른쪽 가격축) */
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const m = this.mapper();
    if (!m) return [];
    return this.model.drawings
      .filter((d) => d.kind === 'hline')
      .map((d) => {
        const price = d.points[0].price;
        return {
          coordinate: () => m.toY(price) ?? -100,
          text: () => this.format(price),
          textColor: () => THEME.chipText,
          backColor: () => d.color ?? DRAW_COLOR,
          visible: () => true,
          tickVisible: () => true,
        };
      });
  }

  private draw(target: DrawTarget): void {
    const m = this.mapper();
    if (!m) return;
    const { drawings, selectedId, hoverId, draft } = this.model;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      for (const d of drawings) {
        const s = shapeOf(d, m);
        if (!s) continue;
        const active = d.id === selectedId || d.id === hoverId;
        paint(ctx, s, m, this.format, active, d.color);
        if (d.id === selectedId) handles(ctx, handlesOf(d, m), d.color ?? DRAW_COLOR);
      }
      if (draft) {
        // 미리 보기: 점이 모자란 평행 채널은 기준선만, 나머지는 마지막 점을 마우스 위치로
        const preview: Drawing =
          draft.kind === 'channel' && draft.points.length < POINTS.channel
            ? { id: 'draft', kind: 'trend', points: draft.points }
            : { id: 'draft', kind: draft.kind, points: draft.points };
        const s = shapeOf(preview, m);
        ctx.globalAlpha = 0.85;
        if (s) paint(ctx, s, m, this.format, true, draft.color);
        handles(ctx, handlesOf(preview, m), draft.color ?? DRAW_COLOR);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    });
  }
}

function line(ctx: Ctx, a: Px, b: Px, color: string, width: number, dash: number[] = []): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 선 굵기는 항상 1px. 마우스가 올라가거나 선택되면 조금 진하게만 */
function paint(ctx: Ctx, s: Shape, m: DrawMapper, format: (p: number) => string, active: boolean, color?: string): void {
  const w = DRAW_LINE_WIDTH;
  const c = color ?? DRAW_COLOR;
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * (active ? 1 : 0.9);
  switch (s.kind) {
    case 'trend':
      line(ctx, s.a, s.b, c, w);
      break;
    case 'hline': {
      const y = Math.round(s.y) + 0.5;
      line(ctx, { x: 0, y }, { x: m.width, y }, c, w);
      break;
    }
    case 'channel': {
      ctx.fillStyle = withAlpha(c, 0.08);
      ctx.beginPath();
      ctx.moveTo(s.a[0].x, s.a[0].y);
      ctx.lineTo(s.a[1].x, s.a[1].y);
      ctx.lineTo(s.b[1].x, s.b[1].y);
      ctx.lineTo(s.b[0].x, s.b[0].y);
      ctx.closePath();
      ctx.fill();
      line(ctx, s.a[0], s.a[1], c, w);
      line(ctx, s.b[0], s.b[1], c, w);
      line(ctx, s.mid[0], s.mid[1], c, w, [4, 4]);
      break;
    }
    case 'fib': {
      const levels = [...s.levels].sort((p, q) => p.level - q.level);
      // 레벨 사이 옅은 채우기
      for (let i = 0; i + 1 < levels.length; i++) {
        const top = Math.min(levels[i].y, levels[i + 1].y);
        const h = Math.abs(levels[i + 1].y - levels[i].y);
        ctx.fillStyle = withAlpha(color ?? FIB_COLORS[String(levels[i + 1].level)] ?? DRAW_COLOR, 0.08);
        ctx.fillRect(s.x1, top, s.x2 - s.x1, h);
      }
      line(ctx, s.a, s.b, color ?? '#9598A1', w, [4, 4]);
      ctx.font = `600 11px ${THEME.font}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const l of levels) {
        // 색을 고르면 모든 레벨이 그 색, 아니면 레벨별 기본 색
        const lc = color ?? FIB_COLORS[String(l.level)] ?? DRAW_COLOR;
        const y = Math.round(l.y) + 0.5;
        line(ctx, { x: s.x1, y }, { x: s.x2, y }, lc, w);
        ctx.fillStyle = lc;
        ctx.fillText(`${l.level} (${format(l.price)})`, s.x1 - 6, y);
      }
      break;
    }
  }
  ctx.globalAlpha = base;
}

function handles(ctx: Ctx, pts: Px[], color: string): void {
  for (const p of pts) {
    ctx.fillStyle = THEME.bg;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
