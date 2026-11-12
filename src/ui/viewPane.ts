import { ChartView, type OverlayInput } from '../chart/chartView';
import { barRemainingMs, formatCountdown } from '../core/countdown';
import type { PaneSel } from '../core/split';
import { TIMEFRAMES, tfMs } from '../core/timeframe';
import type { SymbolInfo, Timeframe } from '../core/types';
import { CandleStore } from '../data/candleStore';
import type { MarketDataProvider } from '../data/provider';
import { CONFIG } from '../config';
import { h, setText } from './dom';
import { tfName } from './format';

/** 보기 칸 하나에 불러올 캔들 수 (계산기 칸보다 적게 — 칸이 여럿이면 처음 열 때 무겁지 않게) */
const PANE_HISTORY = 500;

export interface ViewPaneDeps {
  createProvider: () => MarketDataProvider;
  formatTime: (ms: number) => string;
  /** 차트를 클릭: 이 칸을 계산기 칸으로 (끌어서 움직인 건 클릭이 아님) */
  onActivate: () => void;
  /** 종목·시간봉을 바꿨을 때 (저장용) */
  onChange: (sel: PaneSel) => void;
}

/**
 * 멀티차트의 보기 칸 (2026-11-06). 종목·시간봉을 따로 고르고, 캔들·이동평균·다우 구조·카운트다운만 그린다.
 * 손익비 박스·작도·끌기는 계산기 칸에만 있다. 칸마다 실시간 연결을 따로 연다 (Bybit 공개 스트림).
 */
export class ViewPane {
  readonly root: HTMLDivElement;
  private readonly chart: ChartView;
  private readonly provider: MarketDataProvider;
  private readonly store = new CandleStore();
  private readonly symbolInput: HTMLInputElement;
  private readonly tfSelect: HTMLSelectElement;
  private readonly note: HTMLSpanElement;
  private readonly badge: HTMLSpanElement;
  private stopWatch: (() => void) | null = null;
  private timer: number;
  private seq = 0;
  private symbols: SymbolInfo[] = [];
  private sel: PaneSel;

  constructor(
    sel: PaneSel,
    private readonly deps: ViewPaneDeps,
    datalistId: string,
  ) {
    this.sel = sel;
    this.provider = deps.createProvider();
    this.symbolInput = h('input', { class: 'pane-symbol', list: datalistId, value: sel.symbol, spellcheck: 'false', autocomplete: 'off', 'aria-label': '이 칸 종목' });
    this.symbolInput.addEventListener('change', () => this.pickSymbol());
    this.symbolInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.symbolInput.blur();
    });
    this.tfSelect = h('select', { class: 'pane-tf', 'aria-label': '이 칸 시간봉' });
    this.tfSelect.append(...TIMEFRAMES.map((t) => h('option', { value: t }, tfName(t))));
    this.tfSelect.value = sel.tf;
    this.tfSelect.addEventListener('change', () => this.load({ ...this.sel, tf: this.tfSelect.value as Timeframe }));
    this.badge = h('span', { class: 'pane-badge', 'data-testid': 'pane-badge', hidden: true });
    this.note = h('span', { class: 'pane-note' });
    const hint = h('span', { class: 'pane-hint' }, '차트 클릭 → 계산기');
    const body = h('div', { class: 'pane-chart', title: '클릭하면 이 칸에서 손익비 계산' });
    this.root = h('div', { class: 'pane view-pane', 'data-testid': 'view-pane' }, h('div', { class: 'pane-head' }, this.symbolInput, this.tfSelect, this.badge, this.note, hint), body);
    // 클릭(거의 안 움직이고 짧게 누름)만 계산기 칸 바꾸기로. 끌어서 차트를 움직이는 건 그대로
    let down: { x: number; y: number; t: number } | null = null;
    body.addEventListener('pointerdown', (e) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
    });
    body.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && Date.now() - d.t < 600) this.deps.onActivate();
    });
    const noop = () => {};
    this.chart = new ChartView(body, {
      onDrag: noop,
      onPreset: noop,
      onBoxMove: noop,
      onDragEnd: noop,
      formatTime: deps.formatTime,
      onDrawingsChange: noop,
      onDrawState: noop,
      onDrawingSelect: noop,
    });
    this.timer = window.setInterval(() => this.renderCountdown(), 1_000);
  }

  get selection(): PaneSel {
    return { ...this.sel };
  }

  /** 이 칸 종목에 맡겨 둔 계산 표시 (예: 'LONG 1:2.1'). null이면 숨김 */
  setBadge(text: string | null, side?: 'LONG' | 'SHORT'): void {
    this.badge.hidden = !text;
    setText(this.badge, text ?? '');
    this.badge.dataset.side = side ?? '';
  }

  /** 손익비 박스 (보기만). null이면 지움 */
  setOverlay(o: OverlayInput | null): void {
    this.chart.setOverlay(o);
  }

  setSymbols(list: SymbolInfo[]): void {
    this.symbols = list;
  }

  setVolumePeaks(on: boolean, waveBars: number | null = null): void {
    this.chart.setVolumePeaks(on, waveBars);
  }

  setStructure(bars: number | null): void {
    this.chart.setStructure(bars);
  }

  applyTheme(): void {
    this.chart.applyTheme();
  }

  /** 종목·시간봉을 불러와 실시간 구독 */
  async load(sel: PaneSel): Promise<void> {
    const seq = ++this.seq;
    this.sel = sel;
    this.symbolInput.value = sel.symbol;
    this.tfSelect.value = sel.tf;
    this.deps.onChange({ ...sel });
    this.stopWatch?.();
    this.stopWatch = null;
    const tick = this.symbols.find((s) => s.symbol === sel.symbol)?.tickSize ?? 0.01;
    this.chart.setPriceFormat(tick);
    this.chart.setCandles([], tfMs(sel.tf), true);
    setText(this.note, '불러오는 중');
    try {
      const { candles } = await this.provider.fetchCandles(sel.symbol, sel.tf, Math.min(PANE_HISTORY, CONFIG.historyLimit));
      if (seq !== this.seq) return;
      this.store.setAll(candles);
      this.chart.setCandles(this.store.all(), tfMs(sel.tf), true);
      setText(this.note, '');
    } catch {
      if (seq !== this.seq) return;
      setText(this.note, '불러오지 못함');
      return;
    }
    this.stopWatch = this.provider.watch(sel.symbol, sel.tf, {
      onCandle: (c) => {
        if (seq !== this.seq) return;
        const kind = this.store.upsert(c);
        this.chart.upsertCandle(c, kind, this.store.all());
        this.renderCountdown();
      },
      onPrice: () => {},
      onMessage: () => {},
      onSocketState: (s) => {
        if (seq === this.seq) setText(this.note, s === 'open' ? '' : '재연결 중');
      },
      onReconnected: () => {
        if (seq !== this.seq) return;
        void this.provider.fetchCandles(sel.symbol, sel.tf, PANE_HISTORY).then(({ candles }) => {
          if (seq !== this.seq) return;
          this.store.merge(candles);
          this.chart.setCandles(this.store.all(), tfMs(sel.tf), false);
        });
      },
    });
  }

  destroy(): void {
    this.seq++;
    this.stopWatch?.();
    this.stopWatch = null;
    window.clearInterval(this.timer);
    this.chart.destroy();
    this.root.remove();
  }

  private pickSymbol(): void {
    const v = this.symbolInput.value.trim().toUpperCase().replace(/[\s/\-_]/g, '');
    const want = v.endsWith('USDT') ? v : `${v}USDT`;
    const found = this.symbols.find((s) => s.symbol === want)?.symbol;
    if (!found) {
      this.symbolInput.value = this.sel.symbol;
      return;
    }
    if (found !== this.sel.symbol) void this.load({ ...this.sel, symbol: found });
  }

  private renderCountdown(): void {
    const all = this.store.all();
    const last = all[all.length - 1];
    if (!last) {
      this.chart.setCountdown(null);
      return;
    }
    // 보기 칸은 브라우저 시계로 (계산기 칸처럼 거래소 시각 보정은 하지 않는다)
    const ms = barRemainingMs(last.time, tfMs(this.sel.tf), Date.now());
    this.chart.setCountdown({ text: formatCountdown(ms), price: last.close, up: last.close >= last.open });
  }
}
