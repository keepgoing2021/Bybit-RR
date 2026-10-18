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
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { MA_LINES, sma, smaAt } from '../core/ma';
import { decimalsOf, formatPrice, snapToTick } from '../core/price';
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
  /** 손익비 점선 (누르면 TP 설정) */
  presets: PresetLevel[];
  /** 박스를 진입 봉에서 오른쪽으로 옮긴 봉 수 */
  shiftBars: number;
  /** 2차 이후 분할 진입 가격선 (진행 중 시나리오만) */
  splits: SplitLine[];
  /** 모든 분할 체결 시 평단 (분할이 없거나 계산 전이면 null) */
  avgEntry: number | null;
}

export interface ChartViewCallbacks {
  onDrag(which: DragTarget, price: number): void;
  /** ±% 점선을 눌렀을 때 */
  onPreset(which: DragTarget, price: number): void;
  /** 박스를 좌우로 옮길 때 (봉 수, done: 손을 뗐을 때) */
  onBoxMove(shiftBars: number, done: boolean): void;
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

    // 이동평균선 (MA20, MA100). 값은 왼쪽 위 범례에 표시하고 가격축 라벨은 끈다 (엔트리·SL·TP 라벨과 겹치지 않게)
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
    container.append(legend);

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

  private renderMaLegend(): void {
    for (const m of this.ma) {
      const last = smaAt(this.candles, this.candles.length - 1, m.period);
      m.value.textContent = last ? last.value.toFixed(decimalsOf(this.tickSize)) : '—';
    }
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
      avg: o.avgEntry === null ? null : { price: o.avgEntry, label: `평단 ${formatPrice(o.avgEntry, this.tickSize)}` },
    };
    this.prim.setModel(model);
    this.syncLines(o);
  }

  private syncLines(o: OverlayInput | null): void {
    const want: Record<'entry' | 'sl' | 'tp' | 'avg', { price: number | null; color: string; title: string }> = {
      entry: { price: o ? o.entry : null, color: THEME.entry, title: '엔트리' },
      sl: { price: o ? o.sl : null, color: THEME.loss, title: 'SL' },
      tp: { price: o ? o.tp : null, color: THEME.profit, title: 'TP' },
      avg: { price: o ? o.avgEntry : null, color: '#FFFFFF', title: '평단' },
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
