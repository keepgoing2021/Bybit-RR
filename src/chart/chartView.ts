import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { decimalsOf, snapToTick } from '../core/price';
import type { Candle, Side } from '../core/types';
import { CountdownPrimitive, type CountdownState } from './countdownPrimitive';
import { BoxMoveController, DragController, type DragTarget } from './drag';
import type { PresetLevel } from '../core/presets';
import { hitTestPreset, type BoxGeometry, type SplitLine } from './geometry';
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
  /** 엔트리 ±% 점선 (진행 중 시나리오만) */
  presets: PresetLevel[];
  /** 박스를 오른쪽으로 옮긴 양 (ms) */
  shiftMs: number;
  swing: { time: number; price: number; label: string } | null;
  /** 2차 이후 분할 진입 가격선 (진행 중 시나리오만) */
  splits: SplitLine[];
}

export interface ChartViewCallbacks {
  onDrag(which: DragTarget, price: number): void;
  /** ±% 점선을 눌렀을 때 */
  onPreset(which: DragTarget, price: number): void;
  /** 박스를 좌우로 옮길 때 (done: 손을 뗐을 때) */
  onBoxMove(shiftMs: number, done: boolean): void;
  onDragEnd(which: DragTarget): void;
  formatTime(ms: number): string;
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
  private readonly drag: DragController;
  private readonly mover: BoxMoveController;
  private candles: readonly Candle[] = [];
  private tfMs = 60_000;
  private tickSize = 0.01;
  private overlay: OverlayInput | null = null;
  private lines: { entry: IPriceLine | null; sl: IPriceLine | null; tp: IPriceLine | null } = { entry: null, sl: null, tp: null };
  private hover: DragTarget | null = null;
  private hoverPreset: number | null = null;
  private dragging: DragTarget | null = null;
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
      wickUpColor: THEME.profit,
      wickDownColor: THEME.loss,
    });
    this.series.attachPrimitive(this.prim);
    this.series.attachPrimitive(this.countdown);

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
      getShiftBars: () => Math.round((this.overlay?.shiftMs ?? 0) / this.tfMs),
      onMove: (bars) => this.cb.onBoxMove(bars * this.tfMs, false),
      onMoveEnd: (bars) => this.cb.onBoxMove(bars * this.tfMs, true),
      setChartInteraction: (on) => this.chart.applyOptions({ handleScroll: on, handleScale: on }),
      // 박스 왼쪽 끝이 차트 오른쪽 끝에서 60px 안쪽까지만 가도록
      maxShiftBars: () => {
        const g = this.prim.computeGeometry();
        const ts = this.chart.timeScale();
        const from = g ? ts.coordinateToLogical(g.x1) : null;
        const to = ts.coordinateToLogical(ts.width() - 60);
        if (from === null || to === null) return null;
        return Math.round((this.overlay?.shiftMs ?? 0) / this.tfMs) + Math.floor(to - from);
      },
    });
    this.bindPointer();
  }

  setPriceFormat(tickSize: number): void {
    this.tickSize = tickSize;
    this.series.applyOptions({ priceFormat: { type: 'price', precision: decimalsOf(tickSize), minMove: tickSize } });
  }

  setCandles(candles: readonly Candle[], tfMs: number, resetView: boolean): void {
    this.candles = candles;
    this.tfMs = tfMs;
    this.series.setData(candles.map(toBar));
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
    if (kind === 'insert') this.series.setData(all.map(toBar));
    else this.series.update(toBar(c), kind === 'update');
    if (kind !== 'update') this.rebuildOverlay();
  }

  setOverlay(o: OverlayInput | null): void {
    this.overlay = o;
    this.rebuildOverlay();
  }

  setCountdown(state: CountdownState | null): void {
    this.countdown.set(state);
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
    const shift = o.shiftMs / this.tfMs;
    const end = (o.endTime === null ? last + o.extendBars : this.logicalForTime(o.endTime) ?? last) + shift;
    const swingLogical = o.swing ? this.logicalForTime(o.swing.time) : null;
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
      swing: o.swing && swingLogical !== null && swingLogical >= 0 ? { logical: swingLogical, price: o.swing.price, label: o.swing.label } : null,
      active: this.dragging ?? this.hover,
      presets: o.presets,
      hoverPreset: this.hoverPreset,
      splits: o.splits,
    };
    this.prim.setModel(model);
    this.syncLines(o);
  }

  private syncLines(o: OverlayInput | null): void {
    const want: Record<'entry' | 'sl' | 'tp', { price: number | null; color: string; title: string }> = {
      entry: { price: o ? o.entry : null, color: THEME.entry, title: '엔트리' },
      sl: { price: o ? o.sl : null, color: THEME.loss, title: 'SL' },
      tp: { price: o ? o.tp : null, color: THEME.profit, title: 'TP' },
    };
    for (const key of ['entry', 'sl', 'tp'] as const) {
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
      const p = h ? null : this.presetAt(x, y)?.pct ?? null;
      const body = !h && p === null && this.overlay !== null && this.mover.hover(x, y);
      el.style.cursor = h ? 'ns-resize' : p !== null ? 'pointer' : body ? 'grab' : '';
      if (h !== this.hover || p !== this.hoverPreset) {
        this.hover = h;
        this.hoverPreset = p;
        this.rebuildOverlay();
      }
    };
    const onUp = (e: PointerEvent) => {
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
      if (this.drag.isDragging() || this.mover.isMoving()) e.stopPropagation();
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
