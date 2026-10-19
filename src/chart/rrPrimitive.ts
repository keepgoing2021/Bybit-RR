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
import type { PresetLevel } from '../core/presets';
import type { Side } from '../core/types';
import { computeBoxGeometry, type AvgLine, type BoxGeometry, type CoordMapper, type HuntGeometry, type HuntInput, type SplitLine } from './geometry';
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
  /** SL 선정 캔들의 기간 [from, to) (논리 인덱스). labelY: 이름표 세로 위치 (왼쪽 위 범례 바로 아래) */
  highlight: { from: number; to: number; label: string; labelY: number } | null;
  active: 'sl' | 'tp' | null;
  /** 손익비 점선 */
  presets: PresetLevel[];
  /** 마우스가 올라간 점선 id */
  hoverPreset: string | null;
  /** 2차 이후 분할 진입 가격선 */
  splits: SplitLine[];
  /** 분할별 체결 시 예상 평단 (2차 체결 시 … 전부 체결 시) */
  avgLines: AvgLine[];
  /** 박스가 선택됨 (Delete로 지우기) */
  selected: boolean;
  /** 스탑헌팅존 (SL 기준 꼬리 끝에서 2~10% 바깥) */
  hunt: HuntInput | null;
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
      {
        side: m.side, entry: m.entry, sl: m.sl, tp: m.tp, startLogical: m.startLogical, endLogical: m.endLogical,
        presets: m.presets, splits: m.splits, avgLines: m.avgLines, hunt: m.hunt,
      },
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
          // 왼쪽 위 캔들·이동평균 범례 아래에 둔다 (폰처럼 좁아 범례가 여러 줄이면 그만큼 내려감)
          chip(ctx, m.highlight.label, (xa + xb) / 2 - barSpacing / 2, m.highlight.labelY, THEME.chipDark, THEME.entry, mediaSize.width);
        }
      }

      // 스탑헌팅존: 박스보다 먼저(아래에) 빗금으로
      const hunt = g.hunt ? drawHuntBand(ctx, g.hunt, mediaSize.width, mediaSize.height, (m.highlight?.labelY ?? 0) + 24) : null;
      if (g.hunt) g.hunt.drawn = hunt?.mode ?? null;

      if (g.profit) {
        ctx.fillStyle = THEME.profitFill;
        ctx.fillRect(g.profit.x, g.profit.y, g.profit.w, g.profit.h);
      }
      if (g.loss) {
        ctx.fillStyle = THEME.lossFill;
        ctx.fillRect(g.loss.x, g.loss.y, g.loss.w, g.loss.h);
      }

      // 손익비 점선: 선·'1:'은 수익 쪽 초록, 손익비 숫자(x)만 빨강. 오른쪽 끝 칩이 누르는 자리 (마우스를 올리면 진하게)
      for (const p of g.presets) {
        if (m.tp !== null && Math.abs(p.price - m.tp) < 1e-9) continue; // 지금 TP 자리는 TP 선·이름표가 이미 있다
        const hot = m.hoverPreset === p.id;
        ctx.globalAlpha = (m.closed ? 0.55 : 1) * (hot ? 1 : 0.6);
        ctx.strokeStyle = THEME.profit;
        ctx.lineWidth = hot ? 1.5 : 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(g.x1, Math.round(p.y) + 0.5);
        ctx.lineTo(g.x2, Math.round(p.y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = m.closed ? 0.55 : 1;
        rrChip(ctx, p.label, g.x2 - 3, p.y, hot);
      }
      ctx.globalAlpha = m.closed ? 0.55 : 1;

      // 분할 진입 가격선 (엔트리 색 점선, 이름표는 왼쪽)
      ctx.font = `600 11px ${THEME.font}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (const sp of g.splits) {
        ctx.strokeStyle = THEME.entry;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(g.x1, Math.round(sp.y) + 0.5);
        ctx.lineTo(g.x2, Math.round(sp.y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        if (sp.showLabel) {
          // 촘촘한 분할에서 위쪽 점선이 글자를 가르지 않게 배경색 테두리
          ctx.strokeStyle = THEME.bg;
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.strokeText(sp.label, g.x1 + 4, sp.y - 2);
          ctx.fillStyle = THEME.entry;
          ctx.fillText(sp.label, g.x1 + 4, sp.y - 2);
        }
      }

      // 체결 시 예상 평단: 전부 체결은 굵은 흰 점선 + 흰 칩, 중간 단계는 옅은 잔점선 + 테두리 칩
      for (const a of g.avgLines) {
        ctx.globalAlpha = (m.closed ? 0.55 : 1) * (a.final ? 1 : 0.75);
        ctx.setLineDash(a.final ? [6, 4] : [2, 3]);
        hline(ctx, g.x1, g.x2, a.y, THEME.ink, a.final ? 1.5 : 1);
        ctx.setLineDash([]);
        ctx.globalAlpha = m.closed ? 0.55 : 1;
        if (a.showLabel) {
          // 박스 왼쪽의 분할 이름표(약 56px)를 가리지 않게, 넓으면 긴 이름표·좁으면 짧은 이름표
          ctx.font = `${a.final ? 700 : 600} 11px ${THEME.font}`;
          const fits = ctx.measureText(a.label).width + 12 <= g.x2 - g.x1 - 60;
          avgChip(ctx, fits ? a.label : a.short, g.x2 - 3, a.y, a.final);
        }
      }

      hline(ctx, g.x1, g.x2, g.yEntry, THEME.entry, 1.5);
      if (g.yTp !== null) hline(ctx, g.x1, g.x2, g.yTp, THEME.profit, m.active === 'tp' ? 2.5 : 1.5);
      if (g.ySl !== null) hline(ctx, g.x1, g.x2, g.ySl, THEME.loss, m.active === 'sl' ? 2.5 : 1.5);

      if (!m.closed) {
        if (g.handles.tp) handle(ctx, g.handles.tp, THEME.profit, m.active === 'tp');
        if (g.handles.sl) handle(ctx, g.handles.sl, THEME.loss, m.active === 'sl');
      }

      // 선택됨: 박스 테두리 + 안내
      if (m.selected) {
        const ys = [g.yEntry, g.ySl, g.yTp].filter((v): v is number => v !== null);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        ctx.strokeStyle = THEME.ink;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(Math.round(g.x1) - 3.5, Math.round(top) - 3.5, g.x2 - g.x1 + 7, bottom - top + 7);
        ctx.setLineDash([]);
        chip(ctx, 'Delete 키로 지우기', (g.x1 + g.x2) / 2, bottom + 38, THEME.chipDark, THEME.ink, mediaSize.width, THEME.ink);
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
      // 스탑헌팅존 이름표는 목표·손절·손익비 이름표를 피해서 맨 위에
      if (hunt?.chip && g.hunt) {
        // 왼쪽 아래 TradingView 로고(라이선스 표시)도 가리지 않는다
        const avoid: Box[] = [chipBox(ctx, m.labels.center, cx, g.yEntry, mediaSize.width), { x: 0, y: mediaSize.height - 44, w: 60, h: 44 }];
        if (m.labels.profit && g.yTp !== null) avoid.push(chipBox(ctx, m.labels.profit, cx, g.yTp + outward(g.yTp) * 14, mediaSize.width));
        if (m.labels.loss && g.ySl !== null) avoid.push(chipBox(ctx, m.labels.loss, cx, g.ySl + outward(g.ySl) * 14, mediaSize.width));
        g.hunt.chip = huntChip(ctx, hunt.chip.text, hunt.chip.left, hunt.chip.cy, mediaSize.width, g.hunt.slInside, avoid, g.hunt.x, mediaSize.height);
        g.hunt.avoided = avoid;
      } else if (g.hunt) {
        g.hunt.chip = null;
      }
      ctx.restore();
    });
  }
}

type Ctx = CanvasRenderingContext2D;

/**
 * 빗금 띠 + 가까운·먼 경계 점선 + 해골 이름표 (경계가 화면 밖이면 보이는 부분만).
 * 띠가 화면 밖이거나 이름표보다 얇게만 보이면, 그 쪽 화면 끝에 '스탑헌팅존 ↓/↑' 칩만 붙인다.
 * topReserve: 위쪽 끝에 붙일 때 피할 높이 (캔들 범례·SL 캔들 이름표)
 */
type HuntChipSpec = { text: string; left: number; cy: number };

function drawHuntBand(
  ctx: Ctx,
  h: HuntGeometry,
  width: number,
  height: number,
  topReserve: number,
): { mode: 'band' | 'edge' | null; chip: HuntChipSpec | null } {
  const top = Math.max(0, Math.min(h.yNear, h.yFar));
  const bottom = Math.min(height, Math.max(h.yNear, h.yFar));
  const left = Math.max(0, h.x);
  if (left >= width) return { mode: null, chip: null };
  const below = h.yFar > h.yNear; // 화면 아래쪽으로 뻗는 구간 (LONG)
  let edgeChip: HuntChipSpec | null = null;
  if (bottom - top < 22) {
    // 화면 밖: 구간이 있는 쪽 끝에 방향 칩
    const offscreen = below ? h.yNear > height - 22 : h.yNear < 22;
    if (offscreen || bottom - top >= 1) edgeChip = { text: below ? '스탑헌팅존 ↓' : '스탑헌팅존 ↑', left, cy: below ? height - 14 : topReserve };
    if (bottom - top < 1) return { mode: edgeChip ? 'edge' : null, chip: edgeChip };
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width - left, bottom - top);
  ctx.clip();
  ctx.fillStyle = THEME.huntFill;
  ctx.fillRect(left, top, width - left, bottom - top);
  ctx.strokeStyle = THEME.huntHatch;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = 9;
  const span = bottom - top;
  for (let x = left - span; x < width; x += step) {
    ctx.moveTo(x, bottom);
    ctx.lineTo(x + span, top);
  }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = THEME.huntEdge;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const y of [h.yNear, h.yFar]) {
    if (y < 0 || y > height) continue;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
  // 이름표: 꼬리 쪽 경계 바로 안쪽, 왼쪽 끝 (보이는 띠가 이름표보다 얇으면 위에서 끝 칩으로 대신)
  if (bottom - top < 22) return { mode: 'edge', chip: edgeChip };
  const inward = below ? 1 : -1;
  const edge = h.yNear >= 0 && h.yNear <= height ? h.yNear : inward > 0 ? top : bottom;
  const cy = Math.max(top + 11, Math.min(bottom - 11, edge + inward * 13));
  return { mode: 'band', chip: { text: h.label, left, cy } };
}

type Box = { x: number; y: number; w: number; h: number };

/** chip()이 그릴 자리 (겹침 피하기용) */
function chipBox(ctx: Ctx, text: string, x: number, y: number, paneWidth: number): Box {
  ctx.font = `600 12px ${THEME.font}`;
  const w = ctx.measureText(text).width + 14;
  return { x: Math.max(4, Math.min(x - w / 2, paneWidth - w - 4)), y: y - 10, w, h: 20 };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * 해골 + 글자 칩 (지금 SL이 구간 안이면 경고색).
 * 기본은 구간 왼쪽 끝 안쪽. 다른 이름표·로고와 겹치면 그 옆 → 한 칸 위·아래 → 줄인 칩(해골 + 화살표) 순으로 자리를 찾는다
 */
function huntChip(ctx: Ctx, text: string, left: number, cy: number, width: number, warn: boolean, avoid: Box[] = [], zoneX = left, height = Infinity): Box {
  ctx.font = `700 11px ${THEME.font}`;
  const compact = text.endsWith('↓') ? '↓' : text.endsWith('↑') ? '↑' : '';
  const widthOf = (t: string) => (t ? ctx.measureText(t).width + 32 : 24);
  const place = (w: number): { x: number; y: number } | null => {
    const clampX = (x: number) => Math.max(4, Math.min(x, width - w - 4));
    const xs = [left + 6, ...avoid.flatMap((a) => [a.x + a.w + 6, a.x - w - 6]), zoneX - w - 6, width - w - 4].map(clampX);
    for (const dy of [0, -22, 22]) {
      const y = cy + dy;
      if (y - 9 < 0 || y + 9 > height) continue;
      for (const x of xs) if (avoid.every((a) => !overlaps({ x, y: y - 9, w, h: 18 }, a))) return { x, y };
    }
    return null;
  };
  let label = text;
  let w = widthOf(text);
  let spot = place(w);
  if (!spot) {
    label = compact;
    w = widthOf(compact);
    spot = place(w) ?? { x: Math.max(4, Math.min(left + 6, width - w - 4)), y: cy };
  }
  const { x } = spot;
  cy = spot.y;
  const fg = warn ? THEME.warning : THEME.loss;
  ctx.fillStyle = THEME.chipDark;
  roundRect(ctx, x, cy - 9, w, 18, 4);
  ctx.fill();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, cy - 8.5, w - 1, 17, 4);
  ctx.stroke();
  skull(ctx, x + 6, cy - 6, fg);
  if (label) {
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 24, cy + 0.5);
  }
  return { x, y: cy - 9, w, h: 18 };
}

/** 12px 해골 (머리 · 눈 · 코 · 이) — 글꼴(이모지)에 기대지 않고 선으로 그린다 */
function skull(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 6, y + 5, 5.2, Math.PI, 0); // 정수리
  ctx.lineTo(x + 11.2, y + 7);
  ctx.quadraticCurveTo(x + 11.2, y + 8.6, x + 9.4, y + 8.8);
  ctx.lineTo(x + 9.4, y + 11.4);
  ctx.lineTo(x + 2.6, y + 11.4);
  ctx.lineTo(x + 2.6, y + 8.8);
  ctx.quadraticCurveTo(x + 0.8, y + 8.6, x + 0.8, y + 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = THEME.chipDark;
  ctx.beginPath();
  ctx.arc(x + 3.9, y + 5.6, 1.55, 0, Math.PI * 2);
  ctx.arc(x + 8.1, y + 5.6, 1.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 7.2);
  ctx.lineTo(x + 5.1, y + 8.7);
  ctx.lineTo(x + 6.9, y + 8.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x + 4.7, y + 9.6, 0.7, 1.8);
  ctx.fillRect(x + 6.6, y + 9.6, 0.7, 1.8);
  ctx.restore();
}

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

/** 평단 이름표: 전부 체결은 흰 칩·검은 글씨, 중간 단계는 어두운 칩·흰 테두리·흰 글씨 */
function avgChip(ctx: Ctx, text: string, right: number, y: number, final: boolean): void {
  ctx.font = `${final ? 700 : 600} 11px ${THEME.font}`;
  const w = ctx.measureText(text).width + 12;
  const h = 16;
  ctx.fillStyle = final ? THEME.ink : THEME.chipDark;
  roundRect(ctx, right - w, y - h / 2, w, h, 4);
  ctx.fill();
  if (!final) {
    ctx.strokeStyle = THEME.inkSoft;
    ctx.lineWidth = 1;
    roundRect(ctx, right - w + 0.5, y - h / 2 + 0.5, w - 1, h - 1, 4);
    ctx.stroke();
  }
  ctx.fillStyle = final ? THEME.chipText : THEME.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, right - w + 6, y + 0.5);
}

/** 손익비 점선 이름표 '1:x': 오른쪽 정렬 칩. '1:'(과 '→ TP')은 초록, x만 빨강 */
function rrChip(ctx: Ctx, label: string, right: number, y: number, hot: boolean): void {
  const head = label.slice(0, 2); // '1:'
  const num = label.slice(2);
  const tail = hot ? ' → TP' : '';
  ctx.font = `700 11px ${THEME.font}`;
  const wHead = ctx.measureText(head).width;
  const wNum = ctx.measureText(num).width;
  const wTail = tail ? ctx.measureText(tail).width : 0;
  const w = wHead + wNum + wTail + 12;
  const h = 16;
  const left = right - w;
  ctx.fillStyle = hot ? THEME.chipHot : THEME.chipDark;
  roundRect(ctx, left, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = THEME.profit;
  ctx.lineWidth = hot ? 1.5 : 1;
  ctx.globalAlpha = hot ? 1 : 0.7;
  roundRect(ctx, left + 0.5, y - h / 2 + 0.5, w - 1, h - 1, 4);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let x = left + 6;
  ctx.fillStyle = THEME.profit;
  ctx.fillText(head, x, y + 0.5);
  x += wHead;
  ctx.fillStyle = THEME.loss;
  ctx.fillText(num, x, y + 0.5);
  x += wNum;
  if (tail) {
    ctx.fillStyle = THEME.profit;
    ctx.fillText(tail, x, y + 0.5);
  }
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
