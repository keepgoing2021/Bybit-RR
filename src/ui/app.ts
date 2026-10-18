import { ChartView, type OverlayInput } from '../chart/chartView';
import { CONFIG } from '../config';
import { analyzeAutoLevels, type AutoSL } from '../core/analysis';
import { captureEntry, evaluateFreshness, type FeedSnapshot, type Freshness } from '../core/freshness';
import { barRemainingMs, formatCountdown } from '../core/countdown';
import { applyTrade } from '../core/liveCandle';
import { presetLevels } from '../core/presets';
import { computeMetrics, formatRR, type Metrics } from '../core/metrics';
import { loadSettings, loadSizing, loadState, saveSettings, saveSizing, saveState, type StorageLike, type UiSelection } from '../core/persistence';
import { decimalsOf, formatPrice } from '../core/price';
import { closeScenario, createScenario, restoreAuto, setBoxShift, setLevel, type Scenario } from '../core/scenario';
import { DEFAULT_SETTINGS, sanitizeSettings, type AnalysisSettings } from '../core/settings';
import { DEFAULT_SIZING, planSizing, sanitizeSizing, type SizingPlan, type SizingSettings } from '../core/sizing';
import { barEnd, defaultHigherTf, defaultSlTf, higherTimeframes, slTimeframes, TIMEFRAMES, tfMs } from '../core/timeframe';
import type { PriceTick, Side, SymbolInfo, Timeframe } from '../core/types';
import type { SocketState } from '../data/bybit/socket';
import { CandleStore } from '../data/candleStore';
import type { FeedListener, MarketDataProvider } from '../data/provider';
import { h, setText, show } from './dom';
import { formatClock, formatPct, formatTime, slRationale, tfName, tpRationale } from './format';
import { SymbolPicker } from './symbolPicker';

export type SourceKind = 'bybit' | 'demo';

export interface AppDeps {
  root: HTMLElement;
  storage: StorageLike;
  createProvider(kind: SourceKind): MarketDataProvider;
  /** 브라우저 시계 */
  now(): number;
  /** URL ?source= 로 지정한 공급원 (저장된 선택보다 우선) */
  sourceOverride: SourceKind | null;
}

const DEFAULT_UI: Record<SourceKind, UiSelection> = {
  bybit: { provider: 'bybit', symbol: 'BTCUSDT', timeframe: '15', htf: '60' },
  demo: { provider: 'demo', symbol: 'DEMO-BTC', timeframe: '15', htf: '60' },
};

const SETTING_FIELDS: { key: keyof AnalysisSettings; label: string; options?: [string, string][] }[] = [
  {
    key: 'slMode',
    label: 'SL 방식',
    options: [
      ['swing', '차트 시간봉의 최근 확정 스윙 저점·고점'],
      ['lowestN', '차트 시간봉 최근 N봉의 최저·최고가'],
      ['prevCandle', 'SL 기준 시간봉의 직전 마감 봉'],
      ['spike', '차트 시간봉의 가장 급격한 캔들'],
    ],
  },
  { key: 'slLowestBars', label: '최저·최고 탐색 범위 (마감 봉 수, 최근 N봉 방식. 진행 중인 봉도 포함)' },
  { key: 'lookback', label: '급격한 캔들 탐색 범위 (봉, 급격한 캔들 방식)' },
  { key: 'atrPeriod', label: 'ATR 기간' },
  { key: 'atrMethod', label: 'ATR 계산 방식', options: [['wilder', 'Wilder (TradingView 기본)'], ['sma', '단순 평균']] },
  { key: 'slBufferTicks', label: 'SL 버퍼 (틱)' },
  { key: 'swingBars', label: '스윙 판별 봉 수 (좌우 각각, SL·TP 공통)' },
  {
    key: 'tpMode',
    label: 'TP 스윙 선택',
    options: [['latest', '가장 최근 확정 스윙'], ['beyondEntry', '엔트리 너머의 가장 최근 스윙']],
  },
  { key: 'boxExtendBars', label: '박스 오른쪽 연장 (봉)' },
  { key: 'staleAfterSec', label: '연결 지연 판정 (초)' },
  { key: 'maxPriceAgeSec', label: '가격 유효 시간 (초)' },
];

/** 차트의 노란 띠(SL을 정한 캔들) 이름표 */
function slBandLabel(a: AutoSL, side: Side): string {
  const low = side === 'LONG';
  switch (a.method) {
    case 'swing':
      return `SL 기준 스윙 ${low ? '저점' : '고점'}`;
    case 'lowestN':
      return `SL 기준 최근 ${a.bars ?? '?'}봉 ${low ? '최저' : '최고'}`;
    case 'prevCandle':
      return `SL 기준 ${tfName(a.timeframe)}`;
    default:
      return 'SL 기준 캔들';
  }
}

const usdtFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdt = (n: number) => usdtFmt.format(n);

const emptyFeed = (): FeedSnapshot => ({ socketOpen: false, lastMessageAt: null, clock: null, lastPrice: null });

export class App {
  private provider!: MarketDataProvider;
  private ui!: UiSelection;
  private settings: AnalysisSettings = DEFAULT_SETTINGS;
  private sizing: SizingSettings = DEFAULT_SIZING;
  private symbols: SymbolInfo[] = [];
  private tickSize = 0.01;
  private store = new CandleStore();
  private feed: FeedSnapshot = emptyFeed();
  private socketState: SocketState = 'idle';
  private scenario: Scenario | null = null;
  private loadError: string | null = null;
  private stopWatch: (() => void) | null = null;
  private seq = 0;
  private creating = false;
  private renderQueued = false;
  private toastTimer: number | null = null;
  private readonly lastPriceBySymbol = new Map<string, { price: number; time: number }>();
  private countdown: { text: string; remainingMs: number } | null = null;
  private chart!: ChartView;
  private el!: ReturnType<App['buildDom']>;

  constructor(private readonly d: AppDeps) {}

  async start(): Promise<void> {
    this.settings = loadSettings(this.d.storage);
    this.sizing = loadSizing(this.d.storage);
    const saved = loadState(this.d.storage);
    this.scenario = saved?.scenario ?? null;
    const source = this.d.sourceOverride ?? saved?.ui?.provider ?? 'bybit';
    this.ui = saved?.ui && saved.ui.provider === source ? { ...saved.ui } : { ...DEFAULT_UI[source] };

    this.el = this.buildDom();
    this.chart = new ChartView(this.el.chart, {
      onDrag: (which, price) => {
        if (!this.scenario) return;
        this.scenario = setLevel(this.scenario, which, price);
        this.renderNow();
      },
      onDragEnd: () => this.persist(),
      onBoxMove: (shiftMs, done) => {
        if (!this.scenario) return;
        this.scenario = setBoxShift(this.scenario, shiftMs);
        this.renderNow();
        if (done) this.persist();
      },
      onPreset: (which, price) => {
        if (!this.scenario) return;
        this.scenario = setLevel(this.scenario, which, price);
        this.persist();
        this.renderNow(true);
      },
      formatTime: (ms) => formatTime(ms),
    });
    window.setInterval(() => {
      this.renderStatus();
      this.renderCountdown();
    }, 500);
    await this.switchProvider(source, true);
  }

  // ───────────── 데이터 ─────────────

  private async switchProvider(kind: SourceKind, keepSelection = false): Promise<void> {
    this.stopWatch?.();
    this.stopWatch = null;
    if (!keepSelection) this.ui = { ...DEFAULT_UI[kind], timeframe: this.ui.timeframe, htf: this.ui.htf };
    this.ui.provider = kind;
    this.provider = this.d.createProvider(kind);
    this.symbols = [];
    this.loadError = null;
    this.renderTopbar();
    const seq = ++this.seq;
    try {
      const symbols = await this.provider.listSymbols();
      if (seq !== this.seq) return;
      this.symbols = symbols;
    } catch (e) {
      if (seq !== this.seq) return;
      this.loadError = `종목 목록을 불러오지 못했습니다 (${errText(e)}). 네트워크나 Bybit 접속을 확인하세요. 데이터를 '데모'로 바꾸면 화면은 확인할 수 있습니다.`;
      this.renderAll();
      return;
    }
    if (!this.symbols.some((s) => s.symbol === this.ui.symbol)) this.ui.symbol = this.symbols[0]?.symbol ?? '';
    this.el.picker.setSymbols(this.symbols);
    await this.loadMarket();
  }

  private async loadMarket(): Promise<void> {
    const seq = ++this.seq;
    this.stopWatch?.();
    this.stopWatch = null;
    this.store = new CandleStore();
    this.feed = emptyFeed();
    this.socketState = 'idle';
    this.loadError = null;
    const { symbol, timeframe } = this.ui;
    this.tickSize = this.symbols.find((s) => s.symbol === symbol)?.tickSize ?? 0.01;
    this.chart.setPriceFormat(this.tickSize);
    this.chart.setCandles([], tfMs(timeframe), true);
    this.persist();
    this.renderAll();

    try {
      const { candles } = await this.provider.fetchCandles(symbol, timeframe, CONFIG.historyLimit);
      if (seq !== this.seq) return;
      this.store.setAll(candles);
      this.chart.setCandles(this.store.all(), tfMs(timeframe), true);
    } catch (e) {
      if (seq !== this.seq) return;
      this.loadError = `캔들을 불러오지 못했습니다 (${errText(e)}).`;
    }
    this.stopWatch = this.provider.watch(symbol, timeframe, this.listener(seq, symbol, timeframe));
    this.renderAll();
  }

  private listener(seq: number, symbol: string, tf: Timeframe): FeedListener {
    const live = () => seq === this.seq;
    return {
      onCandle: (c) => {
        if (!live()) return;
        const kind = this.store.upsert(c);
        this.chart.upsertCandle(c, kind, this.store.all());
        // kline 값은 최신 체결보다 늦을 수 있으므로 진행 중 캔들에 최신 체결가를 다시 반영한다
        const lp = this.feed.lastPrice;
        if (!c.confirmed && lp && lp.time >= c.time) this.applyTradeToCandle(lp, tf);
      },
      onPrice: (t) => {
        if (!live()) return;
        if (!this.feed.lastPrice || t.time >= this.feed.lastPrice.time) {
          this.feed.lastPrice = t;
          this.lastPriceBySymbol.set(symbol, { price: t.price, time: t.time });
          this.applyTradeToCandle(t, tf);
          this.renderCountdown(); // 가격 라벨과 같은 순간에 색·위치를 맞춘다
          this.scheduleRender();
        }
      },
      onMessage: (ts, receivedAt) => {
        if (!live()) return;
        this.feed.lastMessageAt = receivedAt;
        if (ts !== null) this.feed.clock = { serverTs: ts, receivedAt };
      },
      onSocketState: (s) => {
        if (!live()) return;
        this.socketState = s;
        this.feed.socketOpen = s === 'open';
        this.renderStatus();
      },
      onReconnected: () => {
        if (!live()) return;
        void this.provider
          .fetchCandles(symbol, tf, CONFIG.historyLimit)
          .then(({ candles }) => {
            if (!live()) return;
            this.store.merge(candles);
            this.chart.setCandles(this.store.all(), tfMs(tf), false);
          })
          .catch((e) => this.toast(`재연결 후 캔들 보충 실패: ${errText(e)}`));
      },
    };
  }

  /** kline 푸시(1~60초 간격) 사이에도 마지막 캔들이 체결가를 따라가게 한다 */
  private applyTradeToCandle(t: PriceTick, tf: Timeframe): void {
    const r = applyTrade(this.store.last(), t, tf);
    if (!r) return;
    const kind = this.store.upsert(r.candle);
    this.chart.upsertCandle(r.candle, kind, this.store.all());
  }

  /** 가격축 카운트다운: 거래소 시각 기준으로 현재 캔들 마감까지 남은 시간 */
  private renderCountdown(): void {
    const last = this.store.last();
    const clock = this.feed.clock;
    if (!this.chart || !last || !clock) {
      this.countdown = null;
      this.chart?.setCountdown(null);
      return;
    }
    const serverNow = clock.serverTs + (this.d.now() - clock.receivedAt);
    const remainingMs = barRemainingMs(last.time, barEnd(this.ui.timeframe, last.time) - last.time, serverNow);
    this.countdown = { text: formatCountdown(remainingMs), remainingMs };
    this.chart.setCountdown({ text: this.countdown.text, price: last.close, up: last.close >= last.open });
  }

  private freshness(): Freshness {
    return evaluateFreshness(this.feed, this.d.now(), {
      staleAfterMs: this.settings.staleAfterSec * 1000,
      maxPriceAgeMs: this.settings.maxPriceAgeSec * 1000,
    });
  }

  // ───────────── 시나리오 ─────────────

  private async onSide(side: Side): Promise<void> {
    if (this.scenario?.status === 'active') {
      this.openDialog();
      return;
    }
    // 클릭 순간의 최신 수신 가격을 가장 먼저 고정한다
    const cap = captureEntry(this.feed, this.d.now(), {
      staleAfterMs: this.settings.staleAfterSec * 1000,
      maxPriceAgeMs: this.settings.maxPriceAgeSec * 1000,
    });
    if (!cap.ok) {
      this.toast(`시나리오를 만들 수 없습니다: ${cap.reason}`);
      return;
    }
    const { symbol, timeframe, htf } = this.ui;
    const slTf = this.currentSlTf();
    const tickSize = this.tickSize;
    const settings = this.settings;
    const ltfCandles = this.store.all().slice();
    const provider = this.provider;

    this.creating = true;
    this.renderStatus();
    // 상위 시간봉 데이터는 클릭 시점에 받는다 (기준 시각 이후 캔들은 분석에서 걸러짐)
    const fetchTf = async (tf: Timeframe | null, limit: number) => {
      if (!tf) return { candles: null, error: null };
      if (tf === timeframe) return { candles: ltfCandles, error: null };
      try {
        return { candles: (await provider.fetchCandles(symbol, tf, limit)).candles, error: null };
      } catch (e) {
        return { candles: null, error: errText(e) };
      }
    };
    const [htfRes, slRes] = await Promise.all([
      fetchTf(htf, CONFIG.historyLimit),
      fetchTf(settings.slMode === 'prevCandle' ? slTf : null, 10),
    ]);
    const auto = analyzeAutoLevels({
      side,
      entry: cap.price,
      cutoff: cap.priceTime,
      tickSize,
      ltf: { timeframe, candles: ltfCandles },
      htf: htf && htfRes.candles ? { timeframe: htf, candles: htfRes.candles } : null,
      slTf: slRes.candles ? { timeframe: slTf, candles: slRes.candles } : null,
      settings,
    });
    if (htf && !htfRes.candles) {
      auto.tp = { ...auto.tp, timeframe: htf, reason: `유효한 자동 TP 없음: 상위 시간봉 데이터 조회 실패 (${htfRes.error})` };
    }
    if (settings.slMode === 'prevCandle' && !slRes.candles) {
      auto.sl = { ...auto.sl, timeframe: slTf, reason: `유효한 자동 SL 없음: SL 기준 시간봉 데이터 조회 실패 (${slRes.error})` };
    }
    this.scenario = createScenario({
      id: newId(),
      symbol,
      timeframe,
      htf,
      side,
      entry: { price: cap.price, priceTime: cap.priceTime, source: cap.source, clickedAt: cap.clickedAt },
      tickSize,
      auto,
      settings,
    });
    this.creating = false;
    this.persist();
    this.renderAll();
  }

  private currentSlTf(): Timeframe {
    const allowed = slTimeframes(this.ui.timeframe);
    return this.ui.slTf && allowed.includes(this.ui.slTf) ? this.ui.slTf : defaultSlTf(this.ui.timeframe);
  }

  private closeActive(): void {
    const s = this.scenario;
    if (!s || s.status !== 'active') return;
    const last = this.lastPriceBySymbol.get(s.symbol);
    if (!last) this.toast('종료 시점 가격을 알 수 없어 엔트리 가격으로 기록했습니다.');
    this.scenario = closeScenario(s, last ?? { price: s.entry, time: s.priceTime });
    this.persist();
    this.renderAll();
  }

  private deleteScenario(): void {
    this.scenario = null;
    this.persist();
    this.renderAll();
  }

  private applyInput(which: 'sl' | 'tp', raw: string): void {
    if (!this.scenario) return;
    const text = raw.trim().replace(/,/g, '');
    if (text === '') {
      this.scenario = setLevel(this.scenario, which, null);
    } else {
      const v = Number(text);
      if (!Number.isFinite(v) || v <= 0) {
        this.toast('가격은 0보다 큰 숫자로 입력하세요.');
        this.renderNow(true);
        return;
      }
      this.scenario = setLevel(this.scenario, which, v);
    }
    this.persist();
    this.renderNow(true);
  }

  private persist(): void {
    saveState(this.d.storage, { version: 1, scenario: this.scenario, ui: this.ui });
  }

  private metricsFor(s: Scenario): Metrics {
    const current = s.status === 'closed' ? s.closed!.price : this.lastPriceBySymbol.get(s.symbol)?.price ?? null;
    return computeMetrics({ side: s.side, entry: s.entry, sl: s.applied.sl, tp: s.applied.tp, current, tickSize: s.tickSize });
  }

  // ───────────── 화면 ─────────────

  private buildDom() {
    const root = this.d.root;
    const sel = (testid: string) => h('select', { 'data-testid': testid });
    const source = sel('source');
    source.append(h('option', { value: 'bybit' }, 'Bybit 선물 실시간'), h('option', { value: 'demo' }, '데모 데이터'));
    const picker = new SymbolPicker(
      (symbol) => {
        this.ui.symbol = symbol;
        void this.loadMarket();
      },
      (query) => this.toast(`'${query}'에 맞는 Bybit USDT 무기한 종목이 없습니다.`),
    );
    const tf = sel('tf');
    tf.append(...TIMEFRAMES.map((t) => h('option', { value: t }, tfName(t))));
    const htf = sel('htf');
    const sltf = sel('sltf');
    const long = h('button', { class: 'side long', 'data-testid': 'btn-long', type: 'button' }, 'LONG');
    const short = h('button', { class: 'side short', 'data-testid': 'btn-short', type: 'button' }, 'SHORT');
    const status = h('span', { class: 'pill', 'data-testid': 'feed-status', 'data-state': 'connecting' }, '연결 중');
    const statusReason = h('span', { class: 'status-reason' });
    const demoBadge = h('span', { class: 'demo-badge', 'data-testid': 'demo-badge' }, '데모 데이터 (실제 시세 아님)');

    const field = (label: string, control: HTMLElement) => h('label', { class: 'field' }, h('span', {}, label), control);
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, 'RR 박스'),
      field('데이터', source),
      field('종목', picker.root),
      field('차트', tf),
      field('SL 기준', sltf),
      field('TP 기준', htf),
      h('div', { class: 'sides' }, long, short),
      h('div', { class: 'status' }, status, statusReason),
      demoBadge,
    );

    const loadError = h('div', { class: 'banner error', 'data-testid': 'load-error', hidden: true });
    const otherText = h('span');
    const otherGo = h('button', { type: 'button', class: 'link' }, '그 종목 보기');
    const otherBanner = h('div', { class: 'banner', 'data-testid': 'other-symbol-banner', hidden: true }, otherText, otherGo);

    const chart = h('div', { class: 'chart', 'data-testid': 'chart' });

    // 패널
    const empty = h(
      'div',
      { class: 'empty' },
      h('p', {}, 'LONG 또는 SHORT를 누르면 그 순간의 최신 체결가를 엔트리로 고정하고, 가격 구조로 SL과 TP를 제안합니다.'),
      h('p', { class: 'muted' }, 'SL과 TP는 차트에서 끌거나 아래 칸에 입력해 고칠 수 있습니다.'),
    );
    const sideChip = h('span', { class: 'side-chip' });
    const title = h('span', { class: 'scenario-title' });
    const stateChip = h('span', { class: 'state-chip' });
    const entry = h('span', { class: 'num big-entry', 'data-testid': 'entry-price' });
    const times = h('p', { class: 'muted small' });
    const rr = h('span', { class: 'rr num', 'data-testid': 'rr' });
    const reasons = h('ul', { class: 'reasons', 'data-testid': 'reasons' });
    const mk = () => h('dd', { class: 'num' });
    const m = { reward: mk(), risk: mk(), current: mk(), currentPct: mk(), currentR: mk() };
    const metrics = h(
      'dl',
      { class: 'metrics' },
      h('dt', {}, '목표 수익률'), m.reward,
      h('dt', {}, '손절률'), m.risk,
      h('dt', {}, '현재가'), m.current,
      h('dt', {}, '현재 손익률'), m.currentPct,
      h('dt', {}, '현재 R 배수'), m.currentR,
    );
    const level = (which: 'sl' | 'tp', name: string) => {
      const input = h('input', {
        'data-testid': `${which}-input`, inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${name} 가격`,
      });
      const badge = h('span', { class: 'source-badge', 'data-testid': `${which}-source` });
      const why = h('p', { class: 'rationale', 'data-testid': `${which}-rationale` });
      input.addEventListener('change', () => this.applyInput(which, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.blur();
          this.renderNow(true);
        }
      });
      const box = h(
        'div',
        { class: `level ${which}` },
        h('div', { class: 'level-head' }, h('span', { class: 'level-name' }, name), badge),
        input,
        why,
      );
      return { box, input, badge, why };
    };
    const sl = level('sl', '손절 SL');
    const tp = level('tp', '목표 TP');
    const sizing = this.buildSizing();
    const restore = h('button', { type: 'button', 'data-testid': 'btn-restore' }, '자동 설정으로 복원');
    const close = h('button', { type: 'button', 'data-testid': 'btn-close' }, '시나리오 종료');
    const del = h('button', { type: 'button', class: 'danger', 'data-testid': 'btn-delete' }, '삭제');
    const card = h(
      'div',
      { class: 'card', hidden: true },
      h('div', { class: 'card-head' }, sideChip, title, stateChip),
      h('div', { class: 'entry-row' }, h('span', { class: 'muted' }, '엔트리'), entry),
      times,
      h('div', { class: 'rr-row' }, h('span', { class: 'muted' }, '손익비'), rr),
      reasons,
      metrics,
      tp.box,
      sl.box,
      sizing.box,
      h('div', { class: 'actions' }, restore, close, del),
      h('p', { class: 'note' }, '가격 기준 수치입니다. 수수료, 슬리피지, 레버리지는 반영하지 않았습니다. 실제 주문이 아닌 가상 시나리오입니다.'),
    );

    const settingsInputs = new Map<keyof AnalysisSettings, HTMLInputElement | HTMLSelectElement>();
    const settingsBody = h('div', { class: 'settings-grid' });
    for (const f of SETTING_FIELDS) {
      const control = f.options
        ? (() => {
            const s = h('select', { 'data-testid': `setting-${f.key}` });
            s.append(...f.options.map(([v, label]) => h('option', { value: v }, label)));
            return s;
          })()
        : h('input', { type: 'number', step: '1', 'data-testid': `setting-${f.key}` });
      control.addEventListener('change', () => this.applySettings());
      settingsInputs.set(f.key, control);
      settingsBody.append(h('label', { class: 'setting' }, h('span', {}, f.label), control));
    }
    const resetSettings = h('button', { type: 'button', class: 'link' }, '기본값으로 되돌리기');
    const settings = h(
      'details',
      { class: 'settings' },
      h('summary', {}, '자동 제안 설정'),
      h('p', { class: 'muted small' }, '확정된 전략이 아닌 초기 가정값입니다. 바꾼 값은 다음 시나리오부터 적용됩니다.'),
      settingsBody,
      resetSettings,
    );

    const disconnect = h('button', { type: 'button', 'data-testid': 'btn-disconnect' }, '연결 끊김 시험 (6초)');
    const demoTools = h(
      'section',
      { class: 'demo-tools', hidden: true },
      h('p', { class: 'muted small' }, '데모 전용: 데이터 끊김과 재연결 동작을 확인합니다.'),
      disconnect,
    );

    const panel = h('aside', { class: 'panel' }, h('section', { class: 'scenario' }, empty, card), settings, demoTools);
    const layout = h('main', { class: 'layout' }, h('section', { class: 'chart-wrap' }, chart), panel);

    const dialogText = h('p');
    const dlgClose = h('button', { type: 'button', 'data-testid': 'dialog-close-scenario' }, '기존 시나리오 종료');
    const dlgDelete = h('button', { type: 'button', class: 'danger', 'data-testid': 'dialog-delete' }, '기존 시나리오 삭제');
    const dlgCancel = h('button', { type: 'button', 'data-testid': 'dialog-cancel' }, '취소');
    const dialog = h(
      'div',
      { class: 'backdrop', 'data-testid': 'dialog', hidden: true },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, dialogText, h('div', { class: 'actions' }, dlgClose, dlgDelete, dlgCancel)),
    );
    const toast = h('div', { class: 'toast', 'data-testid': 'toast', role: 'status', hidden: true });

    root.replaceChildren(topbar, loadError, otherBanner, layout, dialog, toast);

    // 이벤트
    source.addEventListener('change', () => void this.switchProvider(source.value as SourceKind));
    tf.addEventListener('change', () => {
      const t = tf.value as Timeframe;
      this.ui.timeframe = t;
      this.ui.slTf = defaultSlTf(t); // 차트 시간봉을 바꾸면 SL 기준도 한 단계 위 기본값으로
      if (!this.ui.htf || !higherTimeframes(t).includes(this.ui.htf)) this.ui.htf = defaultHigherTf(t);
      void this.loadMarket();
    });
    sltf.addEventListener('change', () => {
      this.ui.slTf = sltf.value as Timeframe;
      this.persist();
    });
    htf.addEventListener('change', () => {
      this.ui.htf = (htf.value || null) as Timeframe | null;
      this.persist();
    });
    long.addEventListener('click', () => void this.onSide('LONG'));
    short.addEventListener('click', () => void this.onSide('SHORT'));
    restore.addEventListener('click', () => {
      if (!this.scenario) return;
      this.scenario = restoreAuto(this.scenario);
      this.persist();
      this.renderNow(true);
    });
    close.addEventListener('click', () => this.closeActive());
    del.addEventListener('click', () => this.deleteScenario());
    otherGo.addEventListener('click', () => {
      if (!this.scenario) return;
      if (!this.symbols.some((s) => s.symbol === this.scenario!.symbol)) {
        this.toast(`${this.scenario.symbol}은(는) 현재 데이터 공급원에 없는 종목입니다. 상단 '데이터'를 바꿔 보세요.`);
        return;
      }
      this.ui.symbol = this.scenario.symbol;
      void this.loadMarket();
    });
    resetSettings.addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      saveSettings(this.d.storage, this.settings);
      this.renderSettings();
      this.renderNow();
    });
    disconnect.addEventListener('click', () => this.provider.simulateDisconnect?.(6_000));
    dlgClose.addEventListener('click', () => {
      this.closeDialog();
      this.closeActive();
    });
    dlgDelete.addEventListener('click', () => {
      this.closeDialog();
      this.deleteScenario();
    });
    dlgCancel.addEventListener('click', () => this.closeDialog());
    dialog.addEventListener('keydown', (e) => e.key === 'Escape' && this.closeDialog());
    // TradingView처럼 Alt+R로 차트 보기 초기화. 한글 입력 상태에서도 되도록 e.code로 본다
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyR') return;
      e.preventDefault();
      this.chart.resetView();
    });

    return {
      source, picker, tf, htf, sltf, long, short, status, statusReason, demoBadge,
      loadError, otherBanner, otherText, chart, empty, card, sideChip, title, stateChip, entry, times, rr, reasons, m,
      sl, tp, sizing, restore, close, del, settingsInputs, demoTools, dialog, dialogText, dlgCancel, toast,
    };
  }

  /** 분할 진입: 운영자산·손실 한도·분할 수·비중을 받아 분할별 금액을 보여준다 */
  private buildSizing() {
    const capital = h('input', {
      'data-testid': 'sizing-capital', inputmode: 'decimal', autocomplete: 'off', placeholder: '예: 10000', 'aria-label': '운영자산 (USDT)',
    });
    const risk = h('input', { 'data-testid': 'sizing-risk', type: 'number', step: '0.1', min: '0.1', max: '10', 'aria-label': '손절 시 손실 (%)' });
    const splits = h('select', { 'data-testid': 'sizing-splits' });
    splits.append(h('option', { value: '1' }, '1회 진입'), h('option', { value: '3' }, '3분할'), h('option', { value: '5' }, '5분할'));
    const weights = h('select', { 'data-testid': 'sizing-weights' });
    const linear = h('option', { value: 'linear' });
    weights.append(linear, h('option', { value: 'equalRisk' }, '분할별 손실 균등'));
    const reason = h('p', { class: 'muted small', 'data-testid': 'sizing-reason' });
    const body = h('tbody');
    const table = h(
      'table',
      { class: 'sizing-table', 'data-testid': 'sizing-table' },
      h('thead', {}, h('tr', {}, ...['차수', '가격', '금액 USDT', '수량', '비중'].map((t) => h('th', {}, t)))),
      body,
    );
    const mk = () => h('dd', { class: 'num' });
    const sum = { total: mk(), lev: mk(), loss: mk(), profit: mk(), avg: mk(), rr: mk() };
    const summary = h(
      'dl',
      { class: 'metrics', 'data-testid': 'sizing-summary' },
      h('dt', {}, '총 포지션'), sum.total,
      h('dt', {}, '필요 레버리지'), sum.lev,
      h('dt', {}, '손절 시 (전부 체결)'), sum.loss,
      h('dt', {}, '목표 도달 시 (전부 체결)'), sum.profit,
      h('dt', {}, '전부 체결 시 평단'), sum.avg,
      h('dt', {}, '전부 체결 시 손익비'), sum.rr,
    );
    const note = h(
      'p',
      { class: 'note' },
      '2차부터는 엔트리~SL 거리를 분할 수로 나눈 가격입니다. 모든 분할이 체결된 뒤 SL에 맞아도 손실이 운영자산의 위 %를 넘지 않게 나눴습니다. 금액은 레버리지 전 포지션 규모이며 증거금 = 금액 ÷ 레버리지. 수량은 거래소 주문 단위로 내림, 수수료·슬리피지 미반영.',
    );
    const field = (label: string, control: HTMLElement) => h('label', { class: 'setting' }, h('span', {}, label), control);
    const box = h(
      'section',
      { class: 'sizing', 'data-testid': 'sizing' },
      h('div', { class: 'level-head' }, h('span', { class: 'level-name' }, '분할 진입')),
      h('div', { class: 'settings-grid' },
        field('운영자산 (USDT)', capital), field('손절 시 손실 (자산 %)', risk), field('분할', splits), field('비중', weights)),
      reason,
      table,
      summary,
      note,
    );
    const apply = () => {
      const cap = Number(capital.value.replace(/[,\s]/g, ''));
      this.sizing = sanitizeSizing({
        capital: capital.value.trim() === '' ? null : cap,
        riskPct: risk.value.trim() === '' ? undefined : Number(risk.value),
        splits: Number(splits.value),
        weightMode: weights.value,
      });
      saveSizing(this.d.storage, this.sizing);
      this.renderNow(true);
    };
    for (const c of [capital, risk, splits, weights]) c.addEventListener('change', apply);
    capital.addEventListener('keydown', (e) => e.key === 'Enter' && capital.blur());
    return { box, capital, risk, splits, weights, linear, reason, table, body, summary, sum };
  }

  private sizingPlan(s: Scenario): { plan: SizingPlan | null; reason: string | null } {
    const info = this.symbols.find((x) => x.symbol === s.symbol);
    const r = planSizing({
      side: s.side, entry: s.entry, sl: s.applied.sl, tp: s.applied.tp, tickSize: s.tickSize,
      qtyStep: info?.qtyStep, minQty: info?.minQty, minNotional: info?.minNotional, settings: this.sizing,
    });
    return r.ok ? { plan: r.plan, reason: null } : { plan: null, reason: r.reason };
  }

  private renderSizing(s: Scenario, force: boolean): SizingPlan | null {
    const z = this.el.sizing;
    const cfg = this.sizing;
    if (force || document.activeElement !== z.capital) z.capital.value = cfg.capital === null ? '' : String(cfg.capital);
    if (force || document.activeElement !== z.risk) z.risk.value = String(cfg.riskPct);
    z.splits.value = String(cfg.splits);
    z.weights.value = cfg.weightMode;
    setText(z.linear, `${cfg.splits === 5 ? '1:2:3:4:5' : cfg.splits === 3 ? '1:2:3' : '1'} 점점 크게`);
    z.weights.disabled = cfg.splits === 1;

    const { plan, reason } = this.sizingPlan(s);
    show(z.reason, reason !== null);
    setText(z.reason, reason ?? '');
    show(z.table, plan !== null);
    show(z.summary, plan !== null);
    if (!plan) return null;

    const info = this.symbols.find((x) => x.symbol === s.symbol);
    const qd = info?.qtyStep ? decimalsOf(info.qtyStep) : 4;
    z.body.replaceChildren(
      ...plan.tranches.map((t) => {
        const row = h(
          'tr',
          { 'data-testid': 'sizing-row', class: t.tooSmall ? 'too-small' : '' },
          h('td', {}, `${t.n}차${t.n === 1 ? ' (엔트리)' : ''}`),
          h('td', { class: 'num' }, formatPrice(t.price, s.tickSize)),
          h('td', { class: 'num' }, usdt(t.notional)),
          h('td', { class: 'num' }, t.qty.toFixed(qd)),
          h('td', { class: 'num' }, `${(t.share * 100).toFixed(1)}%`),
        );
        if (t.tooSmall) row.title = `거래소 최소 주문(수량 ${info?.minQty ?? '?'}, 금액 ${info?.minNotional ?? '?'} USDT) 미만`;
        return row;
      }),
    );
    const lev = plan.leverage;
    setText(z.sum.total, `${usdt(plan.totalNotional)} USDT`);
    setText(z.sum.lev, lev > 1 ? `${(Math.ceil(lev * 10) / 10).toFixed(1)}배 이상` : '없음 (1배 이하)');
    setText(z.sum.loss, `−${usdt(plan.lossAtSl)} (−${plan.lossPct.toFixed(2)}%)`);
    setText(z.sum.profit, plan.profitAtTp === null ? '—' : `+${usdt(plan.profitAtTp)} (+${plan.profitPct!.toFixed(2)}%)`);
    setText(z.sum.avg, formatPrice(plan.avgEntry, s.tickSize));
    setText(z.sum.rr, plan.rr === null ? '—' : formatRR(plan.rr));
    return plan;
  }

  private applySettings(): void {
    const raw: Record<string, unknown> = {};
    for (const [key, control] of this.el.settingsInputs) {
      raw[key] = control instanceof HTMLSelectElement ? control.value : Number(control.value);
    }
    this.settings = sanitizeSettings(raw);
    saveSettings(this.d.storage, this.settings);
    this.renderSettings();
    this.renderTopbar();
    this.renderNow();
  }

  private openDialog(): void {
    const s = this.scenario!;
    setText(
      this.el.dialogText,
      `활성 시나리오(${s.symbol} ${s.side})가 있어 새 시나리오를 만들지 않았습니다. 기존 시나리오를 종료하거나 삭제한 뒤 LONG/SHORT를 다시 누르면, 그 순간의 가격으로 새 엔트리를 잡습니다.`,
    );
    show(this.el.dialog, true);
    this.el.dlgCancel.focus();
  }

  private closeDialog(): void {
    show(this.el.dialog, false);
  }

  private toast(msg: string): void {
    setText(this.el.toast, msg);
    show(this.el.toast, true);
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => show(this.el.toast, false), 5_000);
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  private renderAll(): void {
    this.renderTopbar();
    this.renderSettings();
    this.renderStatus();
    this.renderNow(true);
  }

  private renderTopbar(): void {
    const e = this.el;
    e.source.value = this.ui.provider;
    e.picker.setValue(this.ui.symbol);
    e.tf.value = this.ui.timeframe;
    const highers = higherTimeframes(this.ui.timeframe);
    e.htf.replaceChildren(h('option', { value: '' }, '없음'), ...highers.map((t) => h('option', { value: t }, tfName(t))));
    e.htf.value = this.ui.htf ?? '';
    e.sltf.replaceChildren(...slTimeframes(this.ui.timeframe).map((t) => h('option', { value: t }, tfName(t))));
    // 'SL 기준 시간봉의 직전 마감 봉' 방식에서만 고를 수 있다. 다른 방식은 차트 시간봉을 쓴다.
    const pickable = this.settings.slMode === 'prevCandle';
    e.sltf.value = pickable ? this.currentSlTf() : this.ui.timeframe;
    e.sltf.disabled = !pickable;
    e.sltf.title = pickable ? '' : "지금 SL 방식은 차트 시간봉을 씁니다. 설정의 'SL 방식'이 직전 마감 봉일 때만 바꿀 수 있습니다";
    const demo = this.provider?.isDemo ?? false;
    show(e.demoBadge, demo);
    show(e.demoTools, demo);
    document.body.classList.toggle('is-demo', demo);
    show(e.loadError, this.loadError !== null);
    setText(e.loadError, this.loadError ?? '');
  }

  private renderSettings(): void {
    for (const [key, control] of this.el.settingsInputs) control.value = String(this.settings[key]);
  }

  private renderStatus(): void {
    if (!this.el) return;
    const f = this.freshness();
    const labels: Record<Freshness['status'], string> = {
      live: this.provider?.isDemo ? '데모 실시간' : '실시간',
      connecting: '연결 중',
      stale: '데이터 지연',
      disconnected: '연결 끊김',
    };
    const label = this.socketState === 'reconnecting' ? '재연결 중' : labels[f.status];
    setText(this.el.status, label);
    this.el.status.dataset.state = f.status;
    setText(this.el.statusReason, f.canCreate ? '' : f.reason ?? '');
    const disabled = !f.canCreate || this.creating;
    this.el.long.disabled = disabled;
    this.el.short.disabled = disabled;
    const why = this.creating ? '자동 SL·TP 계산 중' : f.reason ?? '';
    this.el.long.title = why;
    this.el.short.title = why;
  }

  /** 패널과 차트 박스를 갱신. force면 입력 중인 칸도 덮어쓴다 */
  private renderNow(force = false): void {
    const e = this.el;
    const s = this.scenario;
    show(e.empty, !s);
    show(e.card, !!s);

    const onChart = !!s && s.symbol === this.ui.symbol;
    show(e.otherBanner, !!s && !onChart);
    if (s && !onChart) setText(e.otherText, `활성 시나리오: ${s.symbol} ${s.side} (지금 보는 종목과 다름)`);

    if (!s) {
      this.chart.setOverlay(null);
      return;
    }

    const m = this.metricsFor(s);
    const tick = s.tickSize;
    const fp = (p: number | null) => (p === null ? '—' : formatPrice(p, tick));

    e.sideChip.className = `side-chip ${s.side === 'LONG' ? 'long' : 'short'}`;
    setText(e.sideChip, s.side);
    setText(e.title, `${s.symbol}, ${tfName(s.timeframe)}`);
    setText(e.stateChip, s.status === 'active' ? '진행 중' : '종료');
    e.stateChip.dataset.state = s.status;
    setText(e.entry, formatPrice(s.entry, tick));
    setText(
      e.times,
      `클릭 ${formatClock(s.clickedAt)}, 가격 데이터 ${formatClock(s.priceTime)} (${s.priceSource === 'trade' ? '체결가' : '티커 가격'})`,
    );
    setText(e.rr, m.rr === null ? '—' : formatRR(m.rr));
    e.rr.dataset.valid = String(m.valid);
    e.reasons.replaceChildren(...m.reasons.map((r) => h('li', {}, r)));

    setText(e.m.reward, m.rewardPct === null ? '—' : `+${formatPct(m.rewardPct)}`);
    setText(e.m.risk, m.riskPct === null ? '—' : `−${formatPct(m.riskPct)}`);
    const cur = s.status === 'closed' ? s.closed!.price : this.lastPriceBySymbol.get(s.symbol)?.price ?? null;
    setText(e.m.current, `${fp(cur)}${s.status === 'closed' ? ' (종료 시점)' : ''}`);
    setText(e.m.currentPct, m.currentPct === null ? '—' : formatPct(m.currentPct, true));
    setText(e.m.currentR, m.currentR === null ? '—' : fmtR(m.currentR));

    for (const which of ['sl', 'tp'] as const) {
      const row = e[which];
      const value = s.applied[which];
      if (force || document.activeElement !== row.input) row.input.value = value === null ? '' : formatPrice(value, tick);
      row.input.disabled = s.status !== 'active';
      const manual = s.source[which] === 'manual';
      setText(row.badge, manual ? '수동 수정' : '자동');
      row.badge.dataset.source = s.source[which];
      setText(row.why, which === 'sl' ? slRationale(s.auto.sl, s.side) : tpRationale(s.auto.tp, s.side));
    }
    e.restore.disabled = s.status !== 'active';
    e.close.disabled = s.status !== 'active';
    const plan = this.renderSizing(s, force);

    if (!onChart) {
      this.chart.setOverlay(null);
      return;
    }
    const profit = m.rewardDist === null ? null : `목표 +${fp(m.rewardDist)} (${formatPct(m.rewardPct!)})`;
    const loss = m.riskDist === null ? null : `손절 −${fp(m.riskDist)} (${formatPct(m.riskPct!)})`;
    let center = m.valid ? `손익비 ${formatRR(m.rr!)}` : m.reasons[0] ?? '';
    if (m.currentR !== null) center += `, 현재 ${fmtR(m.currentR)}`;
    if (s.status === 'closed') center = `종료, ${center}`;

    const overlay: OverlayInput = {
      side: s.side,
      entry: s.entry,
      sl: s.applied.sl,
      tp: s.applied.tp,
      startTime: s.priceTime,
      endTime: s.status === 'closed' ? s.closed!.time : null,
      extendBars: this.settings.boxExtendBars,
      draggable: s.status === 'active',
      labels: { profit, loss, center, centerValid: m.valid },
      // SL 캔들보다 큰 시간봉 차트에서는 띠가 실제보다 넓어 보이므로 그리지 않는다
      slCandle: s.auto.sl.candle && tfMs(s.auto.sl.timeframe) >= tfMs(this.ui.timeframe)
        ? {
            time: s.auto.sl.candle.time,
            durationMs: barEnd(s.auto.sl.timeframe, s.auto.sl.candle.time) - s.auto.sl.candle.time,
            label: slBandLabel(s.auto.sl, s.side),
          }
        : null,
      presets: s.status === 'active' ? presetLevels(s.side, s.entry, s.tickSize) : [],
      splits:
        s.status === 'active' && plan
          ? plan.tranches.slice(1).map((t) => ({ price: t.price, label: `${t.n}차 ${(t.share * 100).toFixed(0)}%` }))
          : [],
      shiftMs: s.boxShiftMs ?? 0,
      swing: s.auto.tp.swing && s.auto.tp.timeframe
        ? { time: s.auto.tp.swing.time, price: s.auto.tp.swing.price, label: `TP 기준 ${tfName(s.auto.tp.timeframe)} 스윙` }
        : null,
    };
    this.chart.setOverlay(overlay);
  }

  /** E2E 검증용 읽기 전용 정보 */
  debugApi() {
    return {
      getScenario: () => (this.scenario ? structuredClone(this.scenario) : null),
      getMetrics: () => (this.scenario ? this.metricsFor(this.scenario) : null),
      getRenderedGeometry: () => this.chart.getRenderedGeometry(),
      computeExpectedGeometry: () => this.chart.computeExpectedGeometry(),
      chartClientRect: () => this.chart.clientRect(),
      getVisibleRange: () => this.chart.getVisibleRange(),
      isPriceAutoScale: () => this.chart.isPriceAutoScale(),
      getCandleCount: () => this.store.all().length,
      getLastPrice: () => this.feed.lastPrice?.price ?? null,
      getCountdown: () => this.countdown,
      getHighlight: () => this.chart.getHighlight(),
      getOverlayLabels: () => this.chart.getOverlayLabels(),
      /** 마지막 캔들과 최신 가격을 같은 순간에 읽는다 */
      getLiveSnapshot: () => ({ lastCandle: this.store.last() ?? null, lastPrice: this.feed.lastPrice }),
      priceToClientY: (p: number) => this.chart.priceToClientY(p),
      getFeedStatus: () => this.freshness().status,
    };
  }
}

function fmtR(r: number): string {
  return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(2)}R`;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
