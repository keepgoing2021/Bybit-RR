import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Logical,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { candleStats, legendIndex, type CandleStats } from '../core/candleStats';
import { mapPoints, POINTS, setPoint, type Anchor, type Drawing, type DrawingKind } from '../core/drawings';
import { logicalToTime, timeToLogical } from '../core/timeMap';
import { hitTestDrawing, type DrawMapper } from './drawingGeometry';
import { DrawingsPrimitive } from './drawingsPrimitive';
import { MA_LINES, sma, smaAt } from '../core/ma';
import { decimalsOf, snapToTick } from '../core/price';
import type { Candle, Side } from '../core/types';
import { CountdownPrimitive, type CountdownState } from './countdownPrimitive';
import { BoxMoveController, DragController, type DragTarget } from './drag';
import type { PresetLevel } from '../core/presets';
import { hitTestPreset, type AvgLine, type BoxGeometry, type SplitLine } from './geometry';
import { RRBoxPrimitive, type OverlayModel } from './rrPrimitive';
import { THEME } from './theme';

export interface OverlayInput {
  side: Side;
  entry: number;
  sl: number | null;
  tp: number | null;
  /** 시나리오 생성 시각 (ms) — 박스 왼쪽 끝 */
  startTime: number;
  /** 종료 시각 (ms). 진행 중이면 null → 최신 봉 + extendBars */
  endTime: number | null;
  extendBars: number;
  draggable: boolean;
  labels: OverlayModel['labels'];
  /** SL 선정 캔들의 기간 (SL 기준 시간봉이 더 크면 차트 여러 봉에 걸친다) */
  slCandle: { time: number; durationMs: number; label: string } | null;
  /** 손익비 점선 (누르면 TP 설정) */
  presets: PresetLevel[];
  /** 박스를 진입 봉에서 오른쪽으로 옮긴 봉 수 */
  shiftBars: number;
  /** 2차 이후 분할 진입 가격선 (진행 중 시나리오만) */
  splits: SplitLine[];
  /** 분할별 체결 시 예상 평단 (2차 체결 시 … 전부 체결 시). 분할이 없거나 꺼 두면 빈 배열 */
  avgLines: AvgLine[];
}

export interface ChartViewCallbacks {
  onDrag(which: DragTarget, price: number): void;
  /** ±% 점선을 눌렀을 때 */
  onPreset(which: DragTarget, price: number): void;
  /** 박스를 좌우로 옮길 때 (봉 수, done: 손을 뗐을 때) */
  onBoxMove(shiftBars: number, done: boolean): void;
  onDragEnd(which: DragTarget): void;
  formatTime(ms: number): string;
  /** 작도 추가·수정·삭제 (끌기는 놓을 때 한 번) */
  onDrawingsChange(list: Drawing[]): void;
  /** 작도 도구 상태: 고른 도구와 찍은 점 수 (도구를 다 쓰면 null로 돌아온다) */
  onDrawState(state: { tool: DrawingKind | null; placed: number }): void;
}

const toBar = (c: Candle) => ({
  time: (c.time / 1000) as UTCTimestamp,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
});

/** Lightweight Charts 래퍼: 캔들, 손익비 박스, 가격선, SL·TP 드래그 */
export class ChartView {
  private readonly chart: IChartApi;
  private readonly series: ISeriesApi<'Candlestick'>;
  private readonly prim = new RRBoxPrimitive();
  private readonly countdown = new CountdownPrimitive();
  private readonly ohlcEl: HTMLElement;
  /** 마우스가 가리키는 논리 인덱스 (차트 밖이면 null) */
  private hoverLogical: number | null = null;
  private readonly ma: { period: number; label: string; color: string; series: ISeriesApi<'Line'>; value: HTMLElement }[];
  private readonly drag: DragController;
  private readonly mover: BoxMoveController;
  private candles: readonly Candle[] = [];
  private tfMs = 60_000;
  private tickSize = 0.01;
  private overlay: OverlayInput | null = null;
  private lines: Record<'entry' | 'sl' | 'tp' | 'avg', IPriceLine | null> = { entry: null, sl: null, tp: null, avg: null };
  private hover: DragTarget | null = null;
  private hoverPreset: string | null = null;
  private dragging: DragTarget | null = null;
  /** 박스를 눌러 선택한 상태 (Delete로 지우기) */
  private selected = false;
  // 작도
  private readonly drawPrim: DrawingsPrimitive;
  private drawings: Drawing[] = [];
  private tool: DrawingKind | null = null;
  private draft: Anchor[] = [];
  private cursorAnchor: Anchor | null = null;
  private selectedDrawing: string | null = null;
  private hoverDrawing: string | null = null;
  private drawDrag: { id: string; part: 'point' | 'body'; index: number; x0: number; y0: number; orig: Drawing } | null = null;
  /** 이번 누름은 차트 이동으로 넘기지 않는다 (작도 점 찍기·끌기) */
  private swallowPointer = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly container: HTMLElement, private readonly cb: ChartViewCallbacks) {
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.textMuted,
        fontFamily: THEME.font,
        fontSize: 12,
        attributionLogo: true,
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: THEME.line },
      timeScale: {
        borderColor: THEME.line,
        rightOffset: 24, // 박스를 옮겨 둘 빈 공간
        barSpacing: 8,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) => tickLabel(Number(time) * 1000, type),
      },
      localization: {
        locale: 'ko-KR',
        timeFormatter: (time: Time) => cb.formatTime(Number(time) * 1000),
      },
    });
    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: THEME.profit,
      downColor: THEME.loss,
      borderUpColor: THEME.profit,
      borderDownColor: THEME.loss,
      // 꼬리는 흰색 (몸통 색과 구분해 고저가 눈에 띄게)
      wickUpColor: '#FFFFFF',
      wickDownColor: '#FFFFFF',
    });
    // 작도는 손익비 박스 아래에 그린다 (먼저 붙인 것이 아래)
    this.drawPrim = new DrawingsPrimitive(
      () => this.drawMapper(),
      (p) => p.toFixed(decimalsOf(this.tickSize)),
    );
    this.series.attachPrimitive(this.drawPrim);
    this.series.attachPrimitive(this.prim);
    this.series.attachPrimitive(this.countdown);

    // 왼쪽 위 범례: 1줄 캔들 정보(시·고·저·종, 등락, 진폭), 2줄 이동평균. 마우스가 올라간 캔들 기준, 없으면 현재 캔들
    const legendBox = document.createElement('div');
    legendBox.className = 'chart-legend';
    this.ohlcEl = document.createElement('div');
    this.ohlcEl.className = 'ohlc-legend';
    this.ohlcEl.dataset.testid = 'ohlc-legend';
    // 이동평균선 (MA20, MA100). 가격축 라벨은 끈다 (엔트리·SL·TP 라벨과 겹치지 않게)
    const legend = document.createElement('div');
    legend.className = 'ma-legend';
    legend.dataset.testid = 'ma-legend';
    this.ma = MA_LINES.map((m) => {
      const item = document.createElement('span');
      item.style.color = m.color;
      const value = document.createElement('span');
      value.className = 'num';
      item.append(`${m.label} `, value);
      legend.append(item);
      const series = this.chart.addSeries(LineSeries, {
        color: m.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      return { period: m.period, label: m.label, color: m.color, series, value };
    });
    legendBox.append(this.ohlcEl, legend);
    container.append(legendBox);
    this.chart.subscribeCrosshairMove((p) => {
      const logical = p.point && p.logical !== undefined ? Number(p.logical) : null;
      if (logical === this.hoverLogical) return;
      this.hoverLogical = logical;
      this.renderMaLegend();
    });

    this.drag = new DragController({
      getGeometry: () => (this.overlay?.draggable ? this.prim.computeGeometry() : null),
      yToPrice: (y) => this.series.coordinateToPrice(y),
      snap: (p) => snapToTick(p, this.tickSize),
      onDrag: (which, price) => this.cb.onDrag(which, price),
      onDragEnd: (which) => this.cb.onDragEnd(which),
      setChartInteraction: (on) => this.chart.applyOptions({ handleScroll: on, handleScale: on }),
    });
    this.mover = new BoxMoveController({
      getGeometry: () => (this.overlay ? this.prim.computeGeometry() : null),
      xToLogical: (x) => this.chart.timeScale().coordinateToLogical(x),
      getShiftBars: () => this.overlay?.shiftBars ?? 0,
      onMove: (bars) => this.cb.onBoxMove(bars, false),
      onMoveEnd: (bars) => this.cb.onBoxMove(bars, true),
      setChartInteraction: (on) => this.chart.applyOptions({ handleScroll: on, handleScale: on }),
      // 박스 왼쪽 끝이 차트 오른쪽 끝에서 60px 안쪽까지만 가도록
      maxShiftBars: () => {
        const g = this.prim.computeGeometry();
        const ts = this.chart.timeScale();
        const from = g ? ts.coordinateToLogical(g.x1) : null;
        const to = ts.coordinateToLogical(ts.width() - 60);
        if (from === null || to === null) return null;
        return (this.overlay?.shiftBars ?? 0) + Math.floor(to - from);
      },
    });
    this.bindPointer();
  }

  setPriceFormat(tickSize: number): void {
    this.tickSize = tickSize;
    const priceFormat = { type: 'price' as const, precision: decimalsOf(tickSize), minMove: tickSize };
    this.series.applyOptions({ priceFormat });
    for (const m of this.ma) m.series.applyOptions({ priceFormat });
  }

  setCandles(candles: readonly Candle[], tfMs: number, resetView: boolean): void {
    this.candles = candles;
    this.tfMs = tfMs;
    this.series.setData(candles.map(toBar));
    this.setMaData();
    if (resetView) this.resetView();
    this.rebuildOverlay();
  }

  /** 처음 보기로 되돌린다: 최근 봉들 + 오른쪽 여백, 가격축 자동 맞춤 (TradingView Alt+R) */
  resetView(): void {
    const n = this.candles.length;
    const bars = Math.max(30, Math.min(150, Math.floor(this.container.clientWidth / 9)));
    this.chart.priceScale('right').applyOptions({ autoScale: true });
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars), to: n + 24 });
  }

  isPriceAutoScale(): boolean {
    return this.chart.priceScale('right').options().autoScale;
  }

  /** 캔들 저장소가 이미 반영한 값을 차트에 반영한다 */
  upsertCandle(c: Candle, kind: 'append' | 'update' | 'insert', all: readonly Candle[]): void {
    this.candles = all;
    if (kind === 'insert') {
      this.series.setData(all.map(toBar));
      this.setMaData();
    } else {
      this.series.update(toBar(c), kind === 'update');
      this.updateMaFrom(c.time);
    }
    if (kind !== 'update') this.rebuildOverlay();
  }

  private setMaData(): void {
    for (const m of this.ma) m.series.setData(sma(this.candles, m.period).map((p) => ({ time: (p.time / 1000) as UTCTimestamp, value: p.value })));
    this.renderMaLegend();
  }

  /** time 봉부터 끝까지의 MA만 다시 계산 (보통 마지막 1~2봉) */
  private updateMaFrom(time: number): void {
    const all = this.candles;
    let i = all.length - 1;
    while (i > 0 && all[i].time > time) i--;
    for (const m of this.ma) {
      for (let k = i; k < all.length; k++) {
        const p = smaAt(all, k, m.period);
        if (p) m.series.update({ time: (p.time / 1000) as UTCTimestamp, value: p.value }, true);
      }
    }
    this.renderMaLegend();
  }

  /** 범례에 보이는 봉 (마우스가 올라간 캔들, 없거나 오른쪽 빈 곳이면 현재 캔들) */
  private legendBar(): number | null {
    return legendIndex(this.hoverLogical, this.candles.length);
  }

  private renderMaLegend(): void {
    const i = this.legendBar();
    const d = decimalsOf(this.tickSize);
    for (const m of this.ma) {
      const p = i === null ? null : smaAt(this.candles, i, m.period);
      m.value.textContent = p ? p.value.toFixed(d) : '—';
    }
    this.renderOhlc(i === null ? null : candleStats(this.candles, i));
  }

  private renderOhlc(s: CandleStats | null): void {
    const el = this.ohlcEl;
    if (!s) {
      el.replaceChildren();
      return;
    }
    const d = decimalsOf(this.tickSize);
    const dir = s.up ? 'up' : 'down';
    const kv = (k: string, v: number) => {
      const span = document.createElement('span');
      const b = document.createElement('b');
      b.className = `num ${dir}`;
      b.textContent = v.toFixed(d);
      span.append(`${k} `, b);
      return span;
    };
    const sign = s.change >= 0 ? '+' : '−';
    const change = document.createElement('span');
    change.className = `num ${dir}`;
    change.dataset.testid = 'ohlc-change';
    change.textContent = `${sign}${Math.abs(s.change).toFixed(d)} (${sign}${Math.abs(s.changePct).toFixed(2)}%)`;
    const amp = document.createElement('span');
    amp.dataset.testid = 'ohlc-amplitude';
    amp.append('진폭 ');
    const ampV = document.createElement('b');
    ampV.className = 'num';
    ampV.textContent = `${s.amplitudePct.toFixed(2)}%`;
    amp.append(ampV);
    el.replaceChildren(kv('시', s.open), kv('고', s.high), kv('저', s.low), kv('종', s.close), change, amp);
  }

  /** 검증용: 범례에 보이는 봉과 값 */
  getLegend(): { index: number | null; stats: CandleStats | null; text: string } {
    const i = this.legendBar();
    return { index: i, stats: i === null ? null : candleStats(this.candles, i), text: this.ohlcEl.textContent ?? '' };
  }

  /** 검증용: 각 이동평균선의 마지막 점 (차트에 들어간 값) */
  getMaLast(): { label: string; time: number; value: number }[] {
    return this.ma.flatMap((m) => {
      const d = m.series.data();
      const last = d[d.length - 1] as { time: number; value: number } | undefined;
      return last ? [{ label: m.label, time: Number(last.time) * 1000, value: last.value }] : [];
    });
  }

  setOverlay(o: OverlayInput | null): void {
    if (!o) this.selected = false;
    this.overlay = o;
    this.rebuildOverlay();
  }

  setCountdown(state: CountdownState | null): void {
    this.countdown.set(state);
  }

  /** 검증용: 캔들 시작 시각의 차트 안 x 좌표 */
  timeToX(ms: number): number | null {
    return this.chart.timeScale().timeToCoordinate((ms / 1000) as UTCTimestamp);
  }

  // ───────────── 작도 ─────────────

  /** 이 종목의 작도로 바꾼다 (선택·그리던 것은 버림) */
  setDrawings(list: Drawing[]): void {
    this.drawings = list;
    this.selectedDrawing = null;
    this.hoverDrawing = null;
    this.drawDrag = null;
    this.renderDrawings();
  }

  /** 작도 도구 고르기 (null = 커서). 같은 도구를 다시 고르면 처음부터 */
  setTool(kind: DrawingKind | null): void {
    this.tool = kind;
    this.draft = [];
    this.cursorAnchor = null;
    if (kind) {
      this.selectedDrawing = null;
      this.clearSelection();
    }
    if (!kind) this.container.style.cursor = '';
    this.renderDrawings();
    this.cb.onDrawState({ tool: this.tool, placed: 0 });
  }

  getDrawState(): { tool: DrawingKind | null; placed: number } {
    return { tool: this.tool, placed: this.draft.length };
  }

  selectedDrawingId(): string | null {
    return this.selectedDrawing;
  }

  deleteSelectedDrawing(): boolean {
    if (!this.selectedDrawing) return false;
    this.drawings = this.drawings.filter((d) => d.id !== this.selectedDrawing);
    this.selectedDrawing = null;
    this.hoverDrawing = null;
    this.renderDrawings();
    this.cb.onDrawingsChange(this.drawings);
    return true;
  }

  clearDrawingSelection(): void {
    if (!this.selectedDrawing) return;
    this.selectedDrawing = null;
    this.renderDrawings();
  }

  /** 검증용: 작도와 화면 좌표의 끝점 */
  getDrawings(): { drawings: Drawing[]; selected: string | null; handles: Record<string, { x: number; y: number }[]> } {
    const m = this.drawMapper();
    const handles: Record<string, { x: number; y: number }[]> = {};
    for (const d of this.drawings) {
      handles[d.id] = m
        ? d.points.flatMap((p) => {
            const x = m.toX(p.time);
            const y = m.toY(p.price);
            return x === null || y === null ? [] : [{ x, y }];
          })
        : [];
    }
    return { drawings: this.drawings, selected: this.selectedDrawing, handles };
  }

  private times(): number[] {
    return this.candles.map((c) => c.time);
  }

  private drawMapper(): DrawMapper | null {
    if (!this.candles.length) return null;
    const times = this.times();
    const ts = this.chart.timeScale();
    return {
      toX: (t) => {
        const l = timeToLogical(times, this.tfMs, t);
        return l === null ? null : ts.logicalToCoordinate(l as Logical);
      },
      toY: (p) => this.series.priceToCoordinate(p),
      width: ts.width(),
    };
  }

  /** 화면 좌표 → 작도 점. 가로는 가장 가까운 봉(미래 쪽은 시간봉 간격)에 맞춘다 */
  private anchorAt(x: number, y: number): Anchor | null {
    const l = this.chart.timeScale().coordinateToLogical(x);
    const price = this.series.coordinateToPrice(y);
    if (l === null || price === null) return null;
    const time = logicalToTime(this.times(), this.tfMs, Math.round(l));
    return time === null ? null : { time, price: snapToTick(price, this.tickSize) };
  }

  private drawingAt(x: number, y: number): { id: string; part: 'point' | 'body'; index: number } | null {
    const m = this.drawMapper();
    if (!m) return null;
    // 선택된 것 우선, 그다음 나중에 그린 것(위에 있는 것)부터
    const order = [...this.drawings].reverse().sort((a, b) => Number(b.id === this.selectedDrawing) - Number(a.id === this.selectedDrawing));
    for (const d of order) {
      const h = hitTestDrawing(d, m, x, y);
      if (h) return { id: d.id, part: h.part, index: h.part === 'point' ? h.index : -1 };
    }
    return null;
  }

  private placePoint(x: number, y: number): void {
    const kind = this.tool;
    const a = this.anchorAt(x, y);
    if (!kind || !a) return;
    this.draft = [...this.draft, a];
    if (this.draft.length >= POINTS[kind]) {
      const d: Drawing = { id: newDrawingId(), kind, points: this.draft };
      this.drawings = [...this.drawings, d];
      this.selectedDrawing = d.id;
      this.tool = null;
      this.draft = [];
      this.cursorAnchor = null;
      this.container.style.cursor = '';
      this.cb.onDrawingsChange(this.drawings);
    }
    this.renderDrawings();
    this.cb.onDrawState({ tool: this.tool, placed: this.draft.length });
  }

  private dragDrawingTo(x: number, y: number): void {
    const g = this.drawDrag;
    if (!g) return;
    let next: Drawing | null = null;
    if (g.part === 'point') {
      const a = this.anchorAt(x, y);
      if (!a) return;
      next = setPoint(g.orig, g.index, g.orig.kind === 'hline' ? { time: g.orig.points[0].time, price: a.price } : a);
    } else {
      const ts = this.chart.timeScale();
      const l0 = ts.coordinateToLogical(g.x0);
      const l1 = ts.coordinateToLogical(x);
      const p0 = this.series.coordinateToPrice(g.y0);
      const p1 = this.series.coordinateToPrice(y);
      if (l0 === null || l1 === null || p0 === null || p1 === null) return;
      const dl = Math.round(l1 - l0);
      const dp = p1 - p0;
      const times = this.times();
      next = mapPoints(g.orig, (p) => {
        const l = timeToLogical(times, this.tfMs, p.time);
        const t = l === null ? null : logicalToTime(times, this.tfMs, l + dl);
        return { time: t ?? p.time, price: snapToTick(p.price + dp, this.tickSize) };
      });
    }
    this.drawings = this.drawings.map((d) => (d.id === g.id ? next! : d));
    this.renderDrawings();
  }

  private renderDrawings(): void {
    // 미리 보기: 찍은 점 + 마우스 위치 (수평선은 첫 점 전부터 따라다닌다)
    const draft = this.tool && this.cursorAnchor ? { kind: this.tool, points: [...this.draft, this.cursorAnchor] } : null;
    this.drawPrim.set({ drawings: this.drawings, selectedId: this.selectedDrawing, hoverId: this.hoverDrawing, draft });
  }

  /** 검증용: 캔들 꼬리 색 */
  wickColors(): { up: string; down: string } {
    const o = this.series.options();
    return { up: o.wickUpColor, down: o.wickDownColor };
  }

  isBoxSelected(): boolean {
    return this.selected;
  }

  clearSelection(): void {
    if (!this.selected) return;
    this.selected = false;
    this.rebuildOverlay();
  }

  getOverlayLabels(): OverlayInput['labels'] | null {
    return this.overlay?.labels ?? null;
  }

  getHighlight(): { from: number; to: number; label: string } | null {
    return this.prim.getModel()?.highlight ?? null;
  }

  getRenderedGeometry(): BoxGeometry | null {
    return this.prim.getRenderedGeometry();
  }

  computeExpectedGeometry(): BoxGeometry | null {
    return this.prim.computeGeometry();
  }

  getVisibleRange(): { from: number; to: number } | null {
    const r = this.chart.timeScale().getVisibleLogicalRange();
    return r ? { from: r.from, to: r.to } : null;
  }

  clientRect(): { left: number; top: number; width: number; height: number } {
    const r = this.container.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  priceToClientY(price: number): number | null {
    const y = this.series.priceToCoordinate(price);
    return y === null ? null : this.container.getBoundingClientRect().top + y;
  }

  destroy(): void {
    for (const f of this.cleanup) f();
    this.chart.remove();
  }

  /** 시각(ms)을 현재 차트 데이터의 논리 인덱스로. 데이터 범위 밖은 시간봉 길이로 외삽 */
  private logicalForTime(t: number): number | null {
    const c = this.candles;
    if (!c.length) return null;
    if (t < c[0].time) return (t - c[0].time) / this.tfMs;
    const last = c.length - 1;
    if (t >= c[last].time) return last + Math.floor((t - c[last].time) / this.tfMs);
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** [시작 봉, 끝 다음 봉) 논리 범위. 차트에 보이는 데이터 밖이면 null */
  private highlightRange(c: OverlayInput['slCandle']): { from: number; to: number; label: string } | null {
    if (!c) return null;
    const from = this.logicalForTime(c.time);
    const to = this.logicalForTime(c.time + c.durationMs);
    if (from === null || to === null || to < 0) return null;
    return { from, to: Math.max(to, from + 1), label: c.label };
  }

  private rebuildOverlay(): void {
    const o = this.overlay;
    const start = o ? this.logicalForTime(o.startTime) : null;
    if (!o || start === null) {
      this.prim.setModel(null);
      this.syncLines(null);
      return;
    }
    const last = this.candles.length - 1;
    const shift = o.shiftBars;
    const end = (o.endTime === null ? last + o.extendBars : this.logicalForTime(o.endTime) ?? last) + shift;
    const model: OverlayModel = {
      side: o.side,
      entry: o.entry,
      sl: o.sl,
      tp: o.tp,
      startLogical: start + shift,
      endLogical: Math.max(end, start + shift + 1),
      closed: o.endTime !== null,
      labels: o.labels,
      highlight: this.highlightRange(o.slCandle),
      active: this.dragging ?? this.hover,
      presets: o.presets,
      hoverPreset: this.hoverPreset,
      splits: o.splits,
      avgLines: o.avgLines,
      selected: this.selected,
    };
    this.prim.setModel(model);
    this.syncLines(o);
  }

  private syncLines(o: OverlayInput | null): void {
    const want: Record<'entry' | 'sl' | 'tp' | 'avg', { price: number | null; color: string; title: string }> = {
      entry: { price: o ? o.entry : null, color: THEME.entry, title: '엔트리' },
      sl: { price: o ? o.sl : null, color: THEME.loss, title: 'SL' },
      tp: { price: o ? o.tp : null, color: THEME.profit, title: 'TP' },
      avg: { price: o?.avgLines.find((a) => a.final)?.price ?? null, color: '#FFFFFF', title: '예상 평단' },
    };
    for (const key of ['entry', 'sl', 'tp', 'avg'] as const) {
      const { price, color, title } = want[key];
      const line = this.lines[key];
      if (price === null) {
        if (line) this.series.removePriceLine(line);
        this.lines[key] = null;
      } else if (line) {
        line.applyOptions({ price });
      } else {
        this.lines[key] = this.series.createPriceLine({
          price,
          color,
          title,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          lineVisible: true,
          axisLabelVisible: true,
        });
      }
    }
  }

  private presetAt(x: number, y: number) {
    if (!this.overlay?.draggable) return null;
    const g = this.prim.computeGeometry();
    return g ? hitTestPreset(g, x, y) : null;
  }

  private bindPointer(): void {
    const el = this.container;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      // 작도 도구를 고른 상태: 누르는 곳마다 점을 찍는다 (차트는 움직이지 않음)
      if (this.tool) {
        e.preventDefault();
        e.stopPropagation();
        this.swallowPointer = true;
        this.placePoint(x, y);
        return;
      }
      // 작도 위(SL·TP 선이 아닌 곳): 선택하고 끝점·몸통 끌기 시작
      const hit = this.drag.hover(x, y) ? null : this.drawingAt(x, y);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        this.swallowPointer = true;
        this.selected = false;
        this.selectedDrawing = hit.id;
        const orig = this.drawings.find((d) => d.id === hit.id)!;
        this.drawDrag = { id: hit.id, part: hit.part, index: hit.index, x0: x, y0: y, orig };
        el.setPointerCapture?.(e.pointerId);
        this.chart.applyOptions({ handleScroll: false, handleScale: false });
        this.rebuildOverlay();
        this.renderDrawings();
        return;
      }
      if (this.selectedDrawing) {
        this.selectedDrawing = null;
        this.renderDrawings();
      }
      // 박스(선·점선·몸통)를 누르면 선택, 바깥을 누르면 선택 해제
      const g = this.overlay ? this.prim.computeGeometry() : null;
      const onBox = !!g && (this.drag.hover(x, y) !== null || this.presetAt(x, y) !== null || this.mover.hover(x, y));
      if (onBox !== this.selected) {
        this.selected = onBox;
        this.rebuildOverlay();
      }
      if (!this.drag.pointerDown(x, y)) {
        const preset = this.presetAt(x, y);
        if (preset) {
          // 점선 클릭: 그 가격으로 SL/TP 설정. 차트 이동으로 넘어가지 않게 막는다
          e.preventDefault();
          e.stopPropagation();
          this.cb.onPreset(preset.target, preset.price);
          return;
        }
        // 박스 몸통: 좌우로 옮기기
        if (!this.mover.pointerDown(x, y)) return;
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture?.(e.pointerId);
        el.style.cursor = 'grabbing';
        return;
      }
      this.dragging = this.drag.hover(x, y);
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.style.cursor = 'ns-resize';
      this.rebuildOverlay();
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      if (this.tool) {
        this.cursorAnchor = this.anchorAt(x, y);
        el.style.cursor = 'crosshair';
        this.renderDrawings();
        return;
      }
      if (this.drawDrag) {
        e.preventDefault();
        e.stopPropagation();
        this.dragDrawingTo(x, y);
        return;
      }
      const overDrawing = this.drag.hover(x, y) ? null : this.drawingAt(x, y);
      if ((overDrawing?.id ?? null) !== this.hoverDrawing) {
        this.hoverDrawing = overDrawing?.id ?? null;
        this.renderDrawings();
      }
      if (overDrawing) {
        el.style.cursor = overDrawing.part === 'point' ? 'pointer' : 'move';
        el.title = '';
        return;
      }
      if (this.drag.isDragging()) {
        e.preventDefault();
        e.stopPropagation();
        this.drag.pointerMove(x, y);
        return;
      }
      if (this.mover.isMoving()) {
        e.preventDefault();
        e.stopPropagation();
        this.mover.pointerMove(x, y);
        return;
      }
      const h = this.drag.hover(x, y);
      const preset = h ? null : this.presetAt(x, y);
      const p = preset?.id ?? null;
      const body = !h && p === null && this.overlay !== null && this.mover.hover(x, y);
      el.style.cursor = h ? 'ns-resize' : p !== null ? 'pointer' : body ? 'grab' : '';
      el.title = preset ? `누르면 TP를 손익비 ${preset.label} 자리(${preset.price})로 옮깁니다` : '';
      if (h !== this.hover || p !== this.hoverPreset) {
        // 칩 위에서는 가로 십자선이 글자를 가로지르지 않게 잠시 숨긴다
        if ((p !== null) !== (this.hoverPreset !== null)) this.chart.applyOptions({ crosshair: { horzLine: { visible: p === null, labelVisible: p === null } } });
        this.hover = h;
        this.hoverPreset = p;
        this.rebuildOverlay();
      }
    };
    const onUp = (e: PointerEvent) => {
      this.swallowPointer = false;
      if (this.drawDrag) {
        e.stopPropagation();
        el.releasePointerCapture?.(e.pointerId);
        this.drawDrag = null;
        this.chart.applyOptions({ handleScroll: true, handleScale: true });
        this.cb.onDrawingsChange(this.drawings);
        return;
      }
      if (this.mover.isMoving()) {
        e.stopPropagation();
        el.releasePointerCapture?.(e.pointerId);
        el.style.cursor = 'grab';
        this.mover.pointerUp();
        return;
      }
      if (!this.drag.isDragging()) return;
      e.stopPropagation();
      el.releasePointerCapture?.(e.pointerId);
      this.dragging = null;
      this.drag.pointerUp();
      this.rebuildOverlay();
    };
    // 드래그 중에는 차트 라이브러리의 마우스·터치 이벤트로 넘어가지 않게 막는다
    const swallow = (e: Event) => {
      if (this.drag.isDragging() || this.mover.isMoving() || this.swallowPointer || this.drawDrag) e.stopPropagation();
    };
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onUp, true);
    el.addEventListener('mousedown', swallow, true);
    el.addEventListener('mousemove', swallow, true);
    el.addEventListener('touchstart', swallow, true);
    el.addEventListener('touchmove', swallow, true);
    this.cleanup.push(() => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('mousedown', swallow, true);
      el.removeEventListener('mousemove', swallow, true);
      el.removeEventListener('touchstart', swallow, true);
      el.removeEventListener('touchmove', swallow, true);
    });
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function tickLabel(ms: number, type: TickMarkType): string {
  const d = new Date(ms);
  switch (type) {
    case TickMarkType.Year:
      return `${d.getFullYear()}`;
    case TickMarkType.Month:
      return `${d.getMonth() + 1}월`;
    case TickMarkType.DayOfMonth:
      return `${d.getMonth() + 1}/${d.getDate()}`;
    case TickMarkType.TimeWithSeconds:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    default:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

function newDrawingId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
