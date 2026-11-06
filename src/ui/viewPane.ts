import { ChartView } from '../chart/chartView';
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
  /** 「계산기로」: 이 칸의 종목·시간봉을 첫 칸(계산기 칸)으로 */
  onSend: (sel: PaneSel) => void;
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
    const send = h('button', { type: 'button', class: 'pane-send', title: '이 종목·시간봉으로 계산기 칸 바꾸기' }, '계산기로');
    send.addEventListener('click', () => this.deps.onSend({ ...this.sel }));
    this.note = h('span', { class: 'pane-note' });
    const body = h('div', { class: 'pane-chart' });
    this.root = h('div', { class: 'pane view-pane', 'data-testid': 'view-pane' }, h('div', { class: 'pane-head' }, this.symbolInput, this.tfSelect, this.note, send), body);
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

  setSymbols(list: SymbolInfo[]): void {
    this.symbols = list;
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
