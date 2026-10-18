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
import { DragController, type DragTarget } from './drag';
import type { BoxGeometry } from './geometry';
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
  slCandleTime: number | null;
  swing: { time: number; price: number; label: string } | null;
}

export interface ChartViewCallbacks {
  onDrag(which: DragTarget, price: number): void;
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
  private readonly drag: DragController;
  private candles: readonly Candle[] = [];
  private tfMs = 60_000;
  private tickSize = 0.01;
  private overlay: OverlayInput | null = null;
  private lines: { entry: IPriceLine | null; sl: IPriceLine | null; tp: IPriceLine | null } = { entry: null, sl: null, tp: null };
  private hover: DragTarget | null = null;
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
        rightOffset: 14,
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

    this.drag = new DragController({
      getGeometry: () => (this.overlay?.draggable ? this.prim.computeGeometry() : null),
      yToPrice: (y) => this.series.coordinateToPrice(y),
      snap: (p) => snapToTick(p, this.tickSize),
      onDrag: (which, price) => this.cb.onDrag(which, price),
      onDragEnd: (which) => this.cb.onDragEnd(which),
      setChartInteraction: (on) => this.chart.applyOptions({ handleScroll: on, handleScale: on }),
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
    if (resetView) {
      const n = candles.length;
      const bars = Math.max(30, Math.min(150, Math.floor(this.container.clientWidth / 9)));
      this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars), to: n + 14 });
    }
    this.rebuildOverlay();
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

  private exactLogical(t: number): number | null {
    const i = this.logicalForTime(t);
    return i !== null && Number.isInteger(i) && i >= 0 && i < this.candles.length && this.candles[i].time === t ? i : null;
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
    const end = o.endTime === null ? last + o.extendBars : this.logicalForTime(o.endTime) ?? last;
    const swingLogical = o.swing ? this.logicalForTime(o.swing.time) : null;
    const model: OverlayModel = {
      side: o.side,
      entry: o.entry,
      sl: o.sl,
      tp: o.tp,
      startLogical: start,
      endLogical: Math.max(end, start + 1),
      closed: o.endTime !== null,
      labels: o.labels,
      highlightLogical: o.slCandleTime === null ? null : this.exactLogical(o.slCandleTime),
      swing: o.swing && swingLogical !== null && swingLogical >= 0 ? { logical: swingLogical, price: o.swing.price, label: o.swing.label } : null,
      active: this.dragging ?? this.hover,
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

  private bindPointer(): void {
    const el = this.container;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      if (!this.drag.pointerDown(x, y)) return;
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
      const h = this.drag.hover(x, y);
      if (h !== this.hover) {
        this.hover = h;
        el.style.cursor = h ? 'ns-resize' : '';
        this.rebuildOverlay();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!this.drag.isDragging()) return;
      e.stopPropagation();
      el.releasePointerCapture?.(e.pointerId);
      this.dragging = null;
      this.drag.pointerUp();
      this.rebuildOverlay();
    };
    // 드래그 중에는 차트 라이브러리의 마우스·터치 이벤트로 넘어가지 않게 막는다
    const swallow = (e: Event) => {
      if (this.drag.isDragging()) e.stopPropagation();
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
