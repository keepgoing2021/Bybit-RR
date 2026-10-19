import { ChartView, type OverlayInput } from '../chart/chartView';
import { DRAW_COLOR, DRAW_LINE_WIDTH } from '../chart/drawingsPrimitive';
import { isThemeMode, setThemeMode, THEME, type ThemeMode } from '../chart/theme';
import { CONFIG } from '../config';
import { analyzeAutoLevels, type AutoSL } from '../core/analysis';
import { captureEntry, evaluateFreshness, type FeedSnapshot, type Freshness } from '../core/freshness';
import { barRemainingMs, formatCountdown } from '../core/countdown';
import { applyTrade } from '../core/liveCandle';
import { parseRR, rrLevels, tpForRR } from '../core/presets';
import { computeMetrics, formatRR, type Metrics } from '../core/metrics';
import {
  loadDrawings, loadSettings, loadSizing, loadState, saveDrawings, saveSettings, saveSizing, saveState, type StorageLike, type UiSelection,
} from '../core/persistence';
import { DRAW_PALETTE, DRAWING_KINDS, DRAWING_NAMES, isColor, placingHint, type Drawing, type DrawingKind } from '../core/drawings';
import { decimalsOf, formatPrice, snapToTick } from '../core/price';
import { boxShiftOf, createScenario, replaceAuto, restoreAuto, setBoxShift, setEntry, setLevel, type Scenario } from '../core/scenario';
import { DEFAULT_SETTINGS, SL_BUFFER_PCT_RANGE, SL_MODES, sanitizeSettings, type AnalysisSettings, type SlMode } from '../core/settings';
import {
  DEFAULT_SIZING,
  DEFAULT_FEE_TIER,
  FEE_RATES,
  FEE_TIERS,
  feeAtStop,
  feePctText,
  isFeeTier,
  type FeeTier,
  MAX_SPLITS,
  parseSplitCount,
  planSizing,
  ratioLabel,
  readWeightsInput,
  resizeSplits,
  sanitizeSizing,
  weightsText,
  type SizingPlan,
  type SizingSettings,
} from '../core/sizing';
import { barEnd, defaultSlTf, TIMEFRAMES, tfMs } from '../core/timeframe';
import type { Candle, PriceTick, Side, SymbolInfo, Timeframe } from '../core/types';
import type { SocketState } from '../data/bybit/socket';
import { CandleStore } from '../data/candleStore';
import type { FeedListener, MarketDataProvider } from '../data/provider';
import { h, setText, show } from './dom';
import { formatClock, formatPct, formatTime, settingsSummary, SL_MODE_HELP, SL_MODE_NAMES, slRationale, tfName, tpRationale } from './format';
import { HUNT_FAR_PCT, HUNT_NEAR_PCT, huntTip, huntZone, inHuntZone } from '../core/huntZone';
import { FlowBoard } from './flowBoard';
import { SymbolPicker } from './symbolPicker';
import { Tour, type TourStep } from './tour';

export interface AppDeps {
  root: HTMLElement;
  storage: StorageLike;
  /** 시세 공급원 (앱은 Bybit. 자동 테스트만 가짜 시세를 넣는다) */
  createProvider(): MarketDataProvider;
  /** 브라우저 시계 */
  now(): number;
}

/** 처음 열 때 종목 (목록에 없으면 목록의 첫 종목) */
const DEFAULT_UI: UiSelection = { provider: 'bybit', symbol: 'BTCUSDT', timeframe: '15' };

/**
 * 자동 제안 설정 칸. core = 늘 보이는 핵심 4개 (SL 방식 + 그 방식의 숫자 1개 + SL 여유 + 손익비),
 * advanced = '고급'에 접어 두는 것. modes가 있으면 그 SL 방식일 때만 보인다.
 */
type SettingField = { key: keyof AnalysisSettings; label: string; hint?: string; options?: [string, string][]; step?: string; modes?: SlMode[] };
const CORE_SETTINGS: SettingField[] = [
  { key: 'slMode', label: 'SL 방식', options: SL_MODES.map((m) => [m, SL_MODE_NAMES[m]]) },
  { key: 'swingBars', label: '좌우 봉 수', modes: ['swing'] },
  { key: 'slLowestBars', label: '봉 수', modes: ['lowestN'] },
  { key: 'lookback', label: '찾을 봉 수', modes: ['spike'] },
  // SL 여유(%)는 자주 바꾸는 핵심 값이라 여기 대신 패널 손절 줄 바로 아래에 둔다
  { key: 'defaultRR', label: '기본 손익비 1:', step: '0.1' },
];
const ADVANCED_SETTINGS: SettingField[] = [
  // 평균 캔들 크기 = ATR. '가장 큰 캔들' 방식에서만 쓴다
  { key: 'atrPeriod', label: '평균 캔들 크기 (봉)', hint: '큰 캔들 방식' },
  { key: 'atrMethod', label: '평균 내는 법', hint: '큰 캔들 방식', options: [['wilder', '최근 봉 중시'], ['sma', '단순 평균']] },
  { key: 'boxOffsetBars', label: '박스 시작 (봉)' },
  { key: 'boxExtendBars', label: '박스 연장 (봉)' },
  { key: 'staleAfterSec', label: '지연 판정 (초)' },
  { key: 'maxPriceAgeSec', label: '가격 유효 (초)' },
];
/** 바꾸면 지금 계산의 자동 SL·TP를 다시 계산하는 설정 */
const ANALYSIS_KEYS: (keyof AnalysisSettings)[] = ['slMode', 'swingBars', 'slLowestBars', 'lookback', 'atrPeriod', 'atrMethod', 'slBufferPct', 'defaultRR'];

/** 차트의 노란 띠(SL을 정한 캔들) 이름표 */
/** 차트의 SL 캔들 띠 이름. SL 기준 시간봉이 차트와 다르면 시간봉도 붙인다 (예: 'SL 기준 1시간봉 스윙 저점') */
function slBandLabel(a: AutoSL, side: Side, chartTf: Timeframe): string {
  const low = side === 'LONG';
  const tf = a.timeframe !== chartTf ? `${tfName(a.timeframe)} ` : '';
  switch (a.method) {
    case 'swing':
      return `SL 기준 ${tf}스윙 ${low ? '저점' : '고점'}`;
    case 'lowestN':
      return `SL 기준 ${tf}최근 ${a.bars ?? '?'}봉 ${low ? '최저' : '최고'}`;
    case 'prevCandle':
      return `SL 기준 ${tfName(a.timeframe)}`;
    default:
      return `SL 기준 ${tf}캔들`;
  }
}

/** 폰 화면 (styles.css의 640px 구간과 같은 기준) */
const PHONE = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 640px)') : ({ matches: false } as MediaQueryList);

/** 화면 테마 (다크 = 기본, 검정 바탕). index.html의 첫 스크립트도 같은 키를 읽어 깜빡임 없이 연다 */
export const THEME_KEY = 'rrtool.v1.theme';

/** 손절 시 수수료에 쓰는 Bybit 수수료 등급 (일반·VIP1~5) */
export const FEE_TIER_KEY = 'rrtool.v1.feetier';

/** 패널 손절 줄 아래 SL 여유 빠른 선택 (%) */
const SL_BUFFER_CHIPS = [0, 0.5, 1, 2];

/** 패널의 손익비 빠른 선택 칩 */
const RR_CHIPS = [1, 1.5, 2, 2.5, 3];

/** 첫 사용 안내를 봤는지 (끝까지 보거나 건너뛰면 '1'. 그 뒤로는 '?' 버튼으로만 다시 연다) */
export const TOUR_KEY = 'rrtool.v1.tourDone';

const DRAW_TOOLS_KEY = 'rrtool.v1.drawtools';
const DRAW_COLOR_KEY = 'rrtool.v1.drawcolor';

/** 작도 도구 아이콘 (20×20 선화) */
const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${body}</svg>`;
const DRAW_ICONS: Record<DrawingKind | 'clear', string> = {
  trend: svg('<line x1="4" y1="16" x2="16" y2="4"/><circle cx="4" cy="16" r="1.8" fill="currentColor"/><circle cx="16" cy="4" r="1.8" fill="currentColor"/>'),
  hline: svg('<line x1="2" y1="10" x2="18" y2="10"/><circle cx="10" cy="10" r="1.8" fill="currentColor"/>'),
  channel: svg('<line x1="3" y1="12" x2="14" y2="4"/><line x1="6" y1="16" x2="17" y2="8"/><line x1="4.5" y1="14" x2="15.5" y2="6" stroke-dasharray="2 2" stroke-width="1"/>'),
  fib: svg('<line x1="3" y1="4" x2="17" y2="4"/><line x1="3" y1="8" x2="17" y2="8"/><line x1="3" y1="11" x2="17" y2="11"/><line x1="3" y1="16" x2="17" y2="16"/><line x1="4" y1="16" x2="16" y2="4" stroke-dasharray="2 2" stroke-width="1"/>'),
  clear: svg('<path d="M5 6h10M8 6V4h4v2M6.5 6l.8 10h5.4l.8-10"/>'),
};

const usdtFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdt = (n: number) => usdtFmt.format(n);

const emptyFeed = (): FeedSnapshot => ({ socketOpen: false, lastMessageAt: null, clock: null, lastPrice: null });

export class App {
  private provider!: MarketDataProvider;
  private ui!: UiSelection;
  private settings: AnalysisSettings = DEFAULT_SETTINGS;
  private sizing: SizingSettings = DEFAULT_SIZING;
  /** 종목별 작도 */
  private drawingsBySymbol: Record<string, Drawing[]> = {};
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
  private countdown: { text: string; remainingMs: number } | null = null;
  private lastCopied: string | null = null;
  /** 방금 복사한 주문표 칸 (표는 매번 새로 그려지므로 앱이 기억). 1.2초 동안 초록 체크 */
  private copied: { key: string; until: number } | null = null;
  /** 주문표가 마지막으로 그린 내용 (같으면 줄을 다시 만들지 않는다) */
  private sizingTableSig = '';
  private feeTier: FeeTier = DEFAULT_FEE_TIER;
  /** 되돌리기 알림 (마지막 지우기 하나만) */
  private undoAction: { run: () => void; timer: number } | null = null;
  /** SL·TP 선을 끄는 중이면 숫자 굴림 효과를 끈다 */
  private dragging = false;
  private undoFlip = false;
  private lastRolled: { id: string; rr: string; sumRr: string; profit: string } | null = null;
  private chart!: ChartView;
  private themeMode: ThemeMode = 'dark';
  private el!: ReturnType<App['buildDom']>;

  constructor(private readonly d: AppDeps) {}

  async start(): Promise<void> {
    this.settings = loadSettings(this.d.storage);
    this.sizing = loadSizing(this.d.storage);
    this.feeTier = this.loadFeeTier();
    this.drawingsBySymbol = loadDrawings(this.d.storage);
    const saved = loadState(this.d.storage);
    // 계산기라 '종료된 시나리오'는 없다 (이전 버전에서 종료한 것은 버린다)
    this.scenario = saved?.scenario?.status === 'active' ? saved.scenario : null;
    this.ui = saved?.ui ? { ...saved.ui } : { ...DEFAULT_UI };
    // 이전 버전의 slTf는 '직전 마감 봉' 방식에서만 쓰였고 차트를 바꿀 때마다 자동으로 바뀌던 값이다.
    // 그 방식에서 사용자가 기본값과 다르게 고른 경우만 SL 기준으로 옮긴다 (스윙 SL이 갑자기 4시간봉이 되지 않게)
    if (this.ui.slTf !== undefined) {
      const { slTf, ...rest } = this.ui;
      this.ui = rest;
      if (this.ui.slBasis === undefined && this.settings.slMode === 'prevCandle' && slTf !== defaultSlTf(this.ui.timeframe)) {
        this.ui.slBasis = slTf;
      }
    }

    this.themeMode = this.loadTheme();
    this.setTheme(this.themeMode, false);
    this.el = this.buildDom();
    this.chart = new ChartView(this.el.chart, {
      onDrawingsChange: (list) => {
        const sym = this.ui.symbol;
        if (list.length) this.drawingsBySymbol[sym] = list;
        else delete this.drawingsBySymbol[sym];
        saveDrawings(this.d.storage, this.drawingsBySymbol);
      },
      onDrawState: (st) => this.renderDrawTools(st),
      onDrawingSelect: (d) => this.renderDrawEdit(d),
      onDrag: (which, price) => {
        this.dragging = true;
        if (!this.scenario) return;
        this.scenario = setLevel(this.scenario, which, price);
        this.renderNow();
      },
      onDragEnd: () => {
        this.dragging = false;
        this.persist();
        this.renderNow(); // 끄는 동안 멈춰 둔 숫자 굴림을 손을 뗀 자리에서 한 번
      },
      onBoxMove: (bars, done) => {
        if (!this.scenario) return;
        this.scenario = setBoxShift(this.scenario, bars);
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
    this.chart.setDefaultDrawColor(this.loadDrawColor());
    this.setTheme(this.themeMode, false); // 버튼 글자 (차트는 이미 이 테마 색으로 만들어짐)
    PHONE.addEventListener?.('change', () => this.renderTopbar());
    window.setInterval(() => {
      this.renderStatus();
      this.renderCountdown();
    }, 500);
    await this.connect();
    // 처음 들어온 사람에게만 한 번 (차트가 그려진 뒤)
    if (!this.tourDone()) this.openTour();
  }

  private tourDone(): boolean {
    try {
      return this.d.storage.getItem(TOUR_KEY) === '1';
    } catch {
      return false;
    }
  }

  private openTour(): void {
    const e = this.el;
    const steps: TourStep[] = [
      {
        target: () => e.picker.root.closest('.field'),
        title: '종목 고르기',
        body: '누르면 전 종목이 거래대금 순으로 뜹니다. 위 탭으로 상승률·하락률 순으로 바꿀 수 있어요.',
      },
      {
        target: () => e.long.parentElement,
        title: 'LONG 또는 SHORT',
        body: '누르는 순간의 체결가가 진입가가 되고, 손절(SL)·목표(TP)를 자동으로 제안합니다.',
      },
      {
        // 폰에서는 주문 설정이 접혀 있어 그 버튼을 비춘다
        target: () => (e.sizing.bar.getClientRects().length ? e.sizing.bar : e.sizing.fold),
        title: '운영자산과 손실 한도',
        body: '운영자산과 손절 시 잃어도 되는 %를 적으면 분할 주문표가 계산됩니다. 분할 수·비중도 여기서 정합니다.',
      },
      {
        target: () => e.chart.closest('.chart-wrap'),
        title: '차트에서 고치기',
        body: '빨간 SL 선·초록 TP 선을 위아래로 끌어 옮깁니다. 박스 안의 1:x 칩을 누르면 그 손익비로 TP가 갑니다.',
      },
      {
        target: () => e.card.closest('.scenario'),
        title: '주문표 복사',
        body: '계산 결과와 분할 주문표가 여기에 나옵니다. 숫자를 누르면 복사되니 Bybit 주문창에 붙여 넣으세요.',
      },
    ];
    this.chart.clearSelection();
    e.tour.open(steps);
  }

  // ───────────── 데이터 ─────────────

  private async connect(): Promise<void> {
    this.stopWatch?.();
    this.stopWatch = null;
    this.provider = this.d.createProvider();
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
      this.loadError = `종목 목록을 불러오지 못했습니다 (${errText(e)}). 네트워크나 Bybit 접속을 확인한 뒤 새로고침하세요.`;
      this.renderAll();
      return;
    }
    if (!this.symbols.some((s) => s.symbol === this.ui.symbol)) this.ui.symbol = this.symbols[0]?.symbol ?? '';
    this.el.picker.setSymbols(this.symbols);
    this.el.flow.start(this.provider, this.symbols.map((s) => s.symbol));
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
    // 종목을 바꾸면 이전 종목의 계산은 지운다
    if (this.scenario && this.scenario.symbol !== symbol) this.scenario = null;
    this.tickSize = this.symbols.find((s) => s.symbol === symbol)?.tickSize ?? 0.01;
    this.chart.setPriceFormat(this.tickSize);
    this.chart.setCandles([], tfMs(timeframe), true);
    this.chart.setTool(null);
    this.chart.setDrawings(this.drawingsBySymbol[symbol] ?? []);
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

  // ───────────── 계산 ─────────────

  /** LONG/SHORT: 누를 때마다 그 순간 가격으로 새로 계산한다 (이전 계산은 대체) */
  private async onSide(side: Side): Promise<void> {
    if (this.creating) return;
    // 클릭 순간의 최신 수신 가격을 가장 먼저 고정한다
    const cap = captureEntry(this.feed, this.d.now(), {
      staleAfterMs: this.settings.staleAfterSec * 1000,
      maxPriceAgeMs: this.settings.maxPriceAgeSec * 1000,
    });
    if (!cap.ok) {
      this.toast(`계산할 수 없습니다: ${cap.reason}`);
      return;
    }
    const { symbol, timeframe } = this.ui;
    const tickSize = this.tickSize;
    const settings = this.settings;

    this.creating = true;
    this.renderStatus();
    const auto = await this.analyzeAt(side, cap.price, cap.priceTime, settings);
    const created = createScenario({
      id: newId(),
      symbol,
      timeframe,
      side,
      entry: { price: cap.price, priceTime: cap.priceTime, source: cap.source, clickedAt: cap.clickedAt },
      tickSize,
      auto,
      settings,
    });
    // 박스는 진입 봉에서 몇 봉 오른쪽에서 시작해 최근 캔들을 가리지 않는다
    this.scenario = setBoxShift(created, settings.boxOffsetBars);
    this.creating = false;
    this.persist();
    this.renderAll();
  }

  /**
   * 자동 SL·TP 계산. SL은 SL 기준 시간봉 캔들로 (차트와 같으면 차트 캔들, 다르면 그 시간봉을 받아서).
   * 기준 시각(priceTime) 이후 캔들은 분석에서 걸러진다.
   */
  private async analyzeAt(side: Side, entry: number, priceTime: number, settings: AnalysisSettings) {
    const { symbol, timeframe } = this.ui;
    const slTf = this.currentSlTf();
    const ltfCandles = this.store.all().slice();
    const provider = this.provider;
    let slCandles: Candle[] | null = ltfCandles;
    let error: string | null = null;
    if (slTf !== timeframe) {
      // 스윙(좌우 봉)·급격한 캔들(탐색 범위 + ATR)·최근 N봉에 충분한 개수
      const need = Math.max(settings.lookback + settings.atrPeriod, settings.slLowestBars, settings.swingBars * 2 + 1) + 50;
      try {
        slCandles = (await provider.fetchCandles(symbol, slTf, Math.min(CONFIG.historyLimit, need))).candles;
      } catch (e) {
        slCandles = null;
        error = errText(e);
      }
    }
    const auto = analyzeAutoLevels({
      side,
      entry,
      cutoff: priceTime,
      tickSize: this.tickSize,
      ltf: { timeframe, candles: ltfCandles },
      slTf: slCandles ? { timeframe: slTf, candles: slCandles } : null,
      settings,
    });
    if (!slCandles) {
      // 받지 못했으면 차트 시간봉으로 대신 계산하지 않는다 (고른 시간봉과 다른 SL이 나오지 않게)
      auto.sl = {
        ...auto.sl,
        price: null,
        status: 'unavailable',
        candle: null,
        candidatePrice: null,
        timeframe: slTf,
        reason: `유효한 자동 SL 없음: SL 기준 시간봉(${tfName(slTf)}) 데이터 조회 실패 (${error})`,
      };
      auto.tp = { price: null, candidatePrice: null, status: 'unavailable', reason: '유효한 자동 TP 없음: 자동 SL이 없어 기본 손익비 자리를 정할 수 없음', rr: settings.defaultRR };
    }
    return auto;
  }

  /** SL 기준 시간봉: 사용자가 고른 값, 없으면 기본값 (차트 시간봉, '직전 마감 봉' 방식은 한 단계 위) */
  private currentSlTf(): Timeframe {
    return this.ui.slBasis ?? this.defaultSlBasis();
  }

  private defaultSlBasis(): Timeframe {
    return this.settings.slMode === 'prevCandle' ? defaultSlTf(this.ui.timeframe) : this.ui.timeframe;
  }

  /** 상단 'SL 기준'을 바꾸면 지금 계산의 자동 SL을 같은 엔트리·같은 시각 기준으로 다시 계산한다 */
  private async onSlBasisChange(tf: Timeframe): Promise<void> {
    this.ui.slBasis = tf === this.defaultSlBasis() ? undefined : tf;
    this.persist();
    this.renderTopbar();
    await this.recalcAuto();
  }

  /**
   * 지금 계산의 자동 SL·TP를 같은 엔트리·같은 시각 기준으로 다시 계산 (SL 기준·자동 제안 설정을 바꿨을 때).
   * 직접 고친 SL·TP는 그대로 두고 알린다.
   */
  private async recalcAuto(): Promise<void> {
    const s = this.scenario;
    if (!s || s.status !== 'active' || s.symbol !== this.ui.symbol) return;
    const settings = this.settings;
    const auto = await this.analyzeAt(s.side, s.capturedEntry ?? s.entry, s.priceTime, settings);
    if (this.scenario?.id !== s.id) return; // 그 사이 새로 계산했으면 버린다
    this.scenario = replaceAuto(this.scenario, auto, settings);
    if (s.source.sl === 'manual') this.toast("SL을 직접 바꿔 둔 상태라 그대로 둡니다. 새 자동 SL을 쓰려면 '자동값으로 되돌리기'를 누르세요.");
    this.persist();
    this.renderNow(true);
  }

  private clearCalc(): void {
    const prev = this.scenario;
    this.scenario = null;
    this.persist();
    this.renderAll();
    if (prev) {
      this.offerUndo('계산을 지웠습니다', () => {
        if (prev.symbol !== this.ui.symbol) return this.toast('종목이 바뀌어 되돌릴 수 없습니다.');
        this.scenario = prev;
        this.persist();
        this.renderAll();
      });
    }
  }

  /**
   * 손익비·주문표 손익비·목표 시 수익이 바뀌면 숫자가 아래에서 굴러 올라온다.
   * SL·TP 선을 끄는 중(계속 바뀜)이나 손익비를 직접 치는 중에는 하지 않는다. 시세가 움직여도 이 값들은 안 바뀐다
   */
  private rollChanged(id: string, rr: string): void {
    const z = this.el.sizing.sum;
    const now = { id, rr, sumRr: z.rr.textContent ?? '', profit: z.profit.textContent ?? '' };
    // 끄는 동안에는 기준값을 그대로 두어, 손을 떼면 끌기 전과 비교해 한 번만 굴린다
    if (this.dragging) return;
    const prev = this.lastRolled;
    this.lastRolled = now;
    if (!prev) return;
    // 같은 이름의 애니메이션은 다시 돌지 않으므로, 칸마다 지금과 다른 이름으로 바꿔 단다
    const roll = (el: HTMLElement, changed: boolean) => {
      if (!changed) return;
      const next = el.classList.contains('roll-a') ? 'roll-b' : 'roll-a';
      el.classList.remove('roll-a', 'roll-b');
      el.classList.add(next);
    };
    const fresh = prev.id !== id;
    roll(this.el.rr, (fresh || prev.rr !== rr) && document.activeElement !== this.el.rrInput);
    roll(z.rr, fresh || prev.sumRr !== now.sumRr);
    roll(z.profit, fresh || prev.profit !== now.profit);
  }

  /** 작도 지우기(하나·전부)를 되돌릴 수 있게: 지우기 전 목록을 기억 */
  private deleteDrawingWithUndo(): boolean {
    const sym = this.ui.symbol;
    const prev = [...(this.drawingsBySymbol[sym] ?? [])];
    if (!this.chart.deleteSelectedDrawing()) return false;
    this.offerUndo('작도를 지웠습니다', () => this.restoreDrawings(sym, prev));
    return true;
  }

  private restoreDrawings(sym: string, list: Drawing[]): void {
    this.drawingsBySymbol[sym] = list;
    saveDrawings(this.d.storage, this.drawingsBySymbol);
    if (sym === this.ui.symbol) this.chart.setDrawings(list);
  }

  /** 지운 직후 5초 동안 '되돌리기' (Ctrl+Z도). 새로 지우면 앞의 것은 되돌릴 수 없다 */
  private offerUndo(message: string, run: () => void): void {
    const u = this.el.undo;
    if (this.undoAction) window.clearTimeout(this.undoAction.timer);
    show(this.el.toast, false);
    setText(u.text, message);
    // 줄어드는 막대 애니메이션을 처음부터 (두 이름을 번갈아 써서 다시 시작)
    this.undoFlip = !this.undoFlip;
    u.bar.className = `undo-progress ${this.undoFlip ? 'run-a' : 'run-b'}`;
    show(u.root, true);
    const timer = window.setTimeout(() => this.closeUndo(), 5_000);
    this.undoAction = { run, timer };
  }

  private closeUndo(): void {
    if (this.undoAction) window.clearTimeout(this.undoAction.timer);
    this.undoAction = null;
    show(this.el.undo.root, false);
  }

  private runUndo(): void {
    const a = this.undoAction;
    this.closeUndo();
    a?.run();
  }

  private applyInput(which: 'entry' | 'sl' | 'tp', raw: string): void {
    if (!this.scenario) return;
    const text = raw.trim().replace(/,/g, '');
    if (text === '') {
      if (which === 'entry') {
        this.renderNow(true);
        return;
      }
      this.scenario = setLevel(this.scenario, which, null);
    } else {
      const v = Number(text);
      if (!Number.isFinite(v) || v <= 0) {
        this.toast('가격은 0보다 큰 숫자로 입력하세요.');
        this.renderNow(true);
        return;
      }
      this.scenario = which === 'entry' ? setEntry(this.scenario, v) : setLevel(this.scenario, which, v);
    }
    this.persist();
    this.renderNow(true);
  }

  /** 손익비 입력 → TP = 진입 ± 손익비 × 손절폭 (사용자가 직접 정하는 TP. 자동 제안은 역산하지 않는다) */
  private applyRR(raw: string): void {
    const s = this.scenario;
    if (!s) return;
    const rr = parseRR(raw);
    if (rr === null) {
      this.toast('손익비는 0보다 큰 숫자로 입력하세요 (예: 1.5).');
      this.renderNow(true);
      return;
    }
    const tp = tpForRR(s.side, s.entry, s.applied.sl, rr, s.tickSize);
    if (tp === null) {
      this.toast(`손익비로 TP를 정하려면 SL을 진입가 ${s.side === 'LONG' ? '아래' : '위'}에 먼저 두세요.`);
      this.renderNow(true);
      return;
    }
    this.scenario = setLevel(s, 'tp', tp);
    this.persist();
    this.renderNow(true);
  }

  private persist(): void {
    saveState(this.d.storage, { version: 1, scenario: this.scenario, ui: this.ui });
  }

  private metricsFor(s: Scenario): Metrics {
    return computeMetrics({ side: s.side, entry: s.entry, sl: s.applied.sl, tp: s.applied.tp, current: null, tickSize: s.tickSize });
  }

  /** 주문표 숫자 복사 (Bybit 주문창에 붙여 넣기) */
  private copy(value: string, key?: string): void {
    this.lastCopied = value;
    // 성공은 누른 칸에 초록 체크로 (아래 알림 없음)
    const done = () => {
      if (!key) return this.toast(`복사했습니다: ${value}`);
      this.copied = { key, until: Date.now() + 1200 };
      this.renderNow();
      window.setTimeout(() => this.renderNow(), 1250);
    };
    const fallback = () => {
      const ta = h('textarea', {}) as HTMLTextAreaElement;
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        this.toast(`복사하지 못했습니다. 직접 입력하세요: ${value}`);
      }
      ta.remove();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done, fallback);
    else fallback();
  }

  // ───────────── 화면 ─────────────

  private buildDom() {
    const root = this.d.root;
    const sel = (testid: string) => h('select', { 'data-testid': testid });
    const picker = new SymbolPicker(
      (symbol) => {
        this.ui.symbol = symbol;
        void this.loadMarket();
      },
      (query) => this.toast(`'${query}'에 맞는 Bybit USDT 무기한 종목이 없습니다.`),
      () => this.provider.fetchTickers(),
    );
    const tf = sel('tf');
    tf.append(...TIMEFRAMES.map((t) => h('option', { value: t }, tfName(t))));
    const sltf = sel('sltf');
    const long = h('button', { class: 'side long', 'data-testid': 'btn-long', type: 'button' }, 'LONG');
    const short = h('button', { class: 'side short', 'data-testid': 'btn-short', type: 'button' }, 'SHORT');
    const status = h('span', { class: 'pill', 'data-testid': 'feed-status', 'data-state': 'connecting' }, '연결 중');
    const statusReason = h('span', { class: 'status-reason' });
    // 다크/라이트 전환 (누르면 반대 테마로). 폰에서는 아이콘만
    const themeBtn = h('button', { type: 'button', class: 'theme-toggle', 'data-testid': 'theme-toggle' });
    themeBtn.addEventListener('click', () => this.switchTheme(themeBtn));
    // 사용 안내 다시 보기 (처음 한 번은 저절로 뜬다)
    const tourBtn = h(
      'button',
      { type: 'button', class: 'tour-open', 'data-testid': 'tour-open', title: '사용 안내 다시 보기', 'aria-label': '사용 안내 다시 보기' },
      h('span', { class: 'icon', 'aria-hidden': 'true' }, '?'),
      h('span', { class: 'label' }, '안내'),
    );
    tourBtn.addEventListener('click', () => this.openTour());
    const tour = new Tour(() => {
      try {
        this.d.storage.setItem(TOUR_KEY, '1');
      } catch {
        // 저장 못 하면 다음에 또 뜬다
      }
    });

    // 우측 위 5분 순위판: 줄을 누르면 그 종목으로 (종목 칸에서 고른 것과 같다)
    const flow = new FlowBoard((symbol) => {
      if (symbol === this.ui.symbol) return;
      this.ui.symbol = symbol;
      void this.loadMarket();
    });
    const field = (label: string, control: HTMLElement) => h('label', { class: 'field' }, h('span', {}, label), control);
    const sizing = this.buildSizing(field);
    const topbar = h(
      'header',
      { class: 'topbar' },
      // 1RC = 1R calc · 1-click risk calc. 로고는 탭 아이콘과 같은 그림 (손익비 박스 위의 '1')
      h(
        'div',
        { class: 'brand', 'data-testid': 'brand', title: '1RC — Crypto Risk Calculator' },
        h('img', { class: 'brand-mark', src: '/favicon.svg', alt: '', width: '22', height: '22' }),
        h('span', { class: 'brand-text' }, h('b', { class: 'brand-name' }, h('span', { class: 'brand-one' }, '1'), 'RC'), h('small', { class: 'brand-sub' }, 'crypto risk calc')),
      ),
      field('종목', picker.root),
      field('차트', tf),
      field('SL 기준', sltf),
      h('div', { class: 'sides' }, long, short),
      h('div', { class: 'status' }, status, statusReason, tourBtn, themeBtn),
      sizing.fold,
      sizing.bar,
      flow.root,
    );

    const loadError = h('div', { class: 'banner error', 'data-testid': 'load-error', hidden: true });

    const chart = h('div', { class: 'chart', 'data-testid': 'chart' });

    // 패널: 계산기 (진입·손절·목표 → 손익비 → 분할 주문표)
    const empty = h(
      'div',
      { class: 'empty' },
      h('p', {}, 'LONG 또는 SHORT를 누르면 그 순간 가격을 진입가로 잡고, 가격 구조로 SL·TP를 제안해 손익비와 분할 주문표를 바로 계산합니다.'),
      h('p', { class: 'muted' }, '가격은 차트에서 끌거나 아래 칸에 입력해 고칩니다. 다시 누르면 그 순간 가격으로 새로 계산합니다.'),
    );
    const sideChip = h('span', { class: 'side-chip' });
    const title = h('span', { class: 'scenario-title' });
    const del = h('button', { type: 'button', class: 'link', 'data-testid': 'btn-clear' }, '지우기');
    const times = h('p', { class: 'muted small', 'data-testid': 'entry-time' });
    // 손익비는 결과이자 입력: 고치면 TP가 그 손익비 자리로 간다
    const rrInput = h('input', {
      class: 'rr num', 'data-testid': 'rr-input', inputmode: 'decimal', autocomplete: 'off', placeholder: '—', 'aria-label': '손익비 1:X 의 X',
    });
    const rr = h(
      'label',
      { class: 'rr-edit', 'data-testid': 'rr-edit', title: '숫자를 고치면 TP가 그 손익비로 움직입니다' },
      h('span', { class: 'rr num rr-head' }, '1:'),
      rrInput,
      h('span', { class: 'edit-icon', 'aria-hidden': 'true' }, '✎'),
    );
    rrInput.addEventListener('input', () => (rrInput.style.width = `${Math.max(2, rrInput.value.length) + 0.4}ch`));
    rrInput.addEventListener('change', () => this.applyRR(rrInput.value));
    rrInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rrInput.blur();
      if (e.key === 'Escape') {
        rrInput.blur();
        this.renderNow(true);
      }
    });
    const rrLabel = h('span', { class: 'muted' }, '손익비');
    const reasons = h('ul', { class: 'reasons', 'data-testid': 'reasons' });
    const priceRow = (which: 'entry' | 'sl' | 'tp', name: string) => {
      const input = h('input', {
        'data-testid': `${which}-input`, inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${name} 가격`,
      });
      const pct = h('span', { class: 'num pct', 'data-testid': `${which}-pct` });
      const badge = h('span', { class: 'source-badge', 'data-testid': `${which}-source` });
      input.addEventListener('change', () => this.applyInput(which, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.blur();
          this.renderNow(true);
        }
      });
      const row = h('div', { class: `price-row ${which}` }, h('span', { class: 'price-name' }, name), input, pct, badge);
      return { row, input, pct, badge };
    };
    const entry = priceRow('entry', '진입');
    const sl = priceRow('sl', '손절');
    // SL 여유: 손절 줄 바로 아래. 꼬리 끝에서 바깥으로 몇 % 더 둘지 (칩 또는 직접 입력)
    const bufferInput = h('input', {
      class: 'num', 'data-testid': 'sl-buffer', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'SL 여유 % (꼬리 끝 바깥으로)',
    });
    const bufferChips = SL_BUFFER_CHIPS.map((v) => {
      const b = h('button', { type: 'button', class: 'buffer-chip num', 'data-testid': 'sl-buffer-chip', 'data-pct': String(v), 'aria-pressed': 'false' }, `${v}%`);
      b.addEventListener('click', () => void this.setSlBuffer(v));
      return b;
    });
    const bufferNote = h('span', { class: 'buffer-note', 'data-testid': 'sl-buffer-note' });
    // 가격 줄과 같은 칸: 이름(여유) | 입력 % | 설명 / 아래 줄에 빠른 선택 칩, 그 아래 안내
    const bufferRow = h(
      'div',
      { class: 'buffer-row', 'data-testid': 'sl-buffer-row', title: '자동 SL을 꼬리 끝(롱은 저가, 숏은 고가)에서 바깥으로 이만큼 더 둡니다' },
      h('span', { class: 'buffer-name' }, '여유'),
      h('label', { class: 'buffer-input' }, bufferInput, h('span', { class: 'buffer-unit' }, '%')),
      h('span', { class: 'buffer-hint' }, 'SL을 꼬리 끝 바깥으로'),
      h('div', { class: 'buffer-chips', role: 'group', 'aria-label': 'SL 여유 빠른 선택' }, ...bufferChips),
      bufferNote,
    );
    bufferInput.addEventListener('change', () => {
      const v = Number(bufferInput.value.replace('%', '').replace(',', '.').trim());
      if (bufferInput.value.trim() === '' || !Number.isFinite(v)) {
        this.toast(`SL 여유는 ${SL_BUFFER_PCT_RANGE[0]}~${SL_BUFFER_PCT_RANGE[1]} 사이 숫자로 적으세요 (예: 0.5).`);
        bufferInput.value = String(this.settings.slBufferPct);
        return;
      }
      void this.setSlBuffer(v);
    });
    bufferInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') bufferInput.blur();
      if (e.key === 'Escape') {
        bufferInput.value = String(this.settings.slBufferPct);
        bufferInput.blur();
      }
    });
    const tp = priceRow('tp', '목표');
    const slWhy = h('p', { class: 'rationale', 'data-testid': 'sl-rationale' });
    const tpWhy = h('p', { class: 'rationale', 'data-testid': 'tp-rationale' });
    const restore = h('button', { type: 'button', 'data-testid': 'btn-restore' }, '자동값으로 되돌리기');
    // 손익비 빠른 선택: 누르면 TP가 그 손익비 자리로 (차트의 1:x 칩과 같은 동작)
    const rrChips = RR_CHIPS.map((v) => {
      const b = h('button', { type: 'button', class: 'rr-chip num', 'data-testid': 'rr-chip', 'data-rr': String(v), 'aria-pressed': 'false' }, `1:${v}`);
      b.addEventListener('click', () => this.applyRR(String(v)));
      return b;
    });
    // 패널은 카드 묶음: 가격 / 손익비 / 주문표 / 근거
    const card = h(
      'div',
      { class: 'card', hidden: true },
      h('div', { class: 'card-head' }, sideChip, title, del),
      h('div', { class: 'panel-card levels', 'data-testid': 'group-levels' }, h('div', { class: 'prices' }, entry.row, sl.row, bufferRow, tp.row), times),
      h(
        'div',
        { class: 'panel-card rr-group', 'data-testid': 'group-rr' },
        h('div', { class: 'rr-row' }, rrLabel, rr),
        h('div', { class: 'rr-chips', 'data-testid': 'rr-chips', role: 'group', 'aria-label': '손익비 빠른 선택' }, ...rrChips),
        h('p', { class: 'rr-hint', 'data-testid': 'rr-hint' }, '✎ 숫자를 고치거나 1:x 칩을 누르면 TP 이동'),
      ),
      reasons,
      sizing.box,
      h('div', { class: 'panel-card why', 'data-testid': 'group-why' }, h('p', { class: 'why-title' }, '자동 제안 근거'), slWhy, tpWhy),
      h('div', { class: 'actions' }, restore),
      h('p', { class: 'note' }, '가격 기준 계산입니다. 수수료·슬리피지·펀딩비는 반영하지 않았습니다. 주문은 Bybit에서 직접 넣습니다.'),
    );

    const settingsInputs = new Map<keyof AnalysisSettings, HTMLInputElement | HTMLSelectElement>();
    const settingRows = new Map<keyof AnalysisSettings, { row: HTMLElement; modes?: SlMode[] }>();
    const buildRows = (fields: SettingField[]) =>
      fields.map((f) => {
        const control = f.options
          ? (() => {
              const sel = h('select', { 'data-testid': `setting-${f.key}` });
              sel.append(...f.options.map(([v, label]) => h('option', { value: v }, label)));
              return sel;
            })()
          : h('input', { type: 'number', step: f.step ?? '1', inputmode: 'decimal', 'data-testid': `setting-${f.key}` });
        control.addEventListener('change', () => void this.applySettings(f.key));
        settingsInputs.set(f.key, control);
        const name = h('span', { class: 'setting-name' }, f.label);
        const row = h('label', { class: 'setting', 'data-key': f.key }, h('span', {}, name, f.hint ? h('small', {}, f.hint) : ''), control);
        settingRows.set(f.key, { row, modes: f.modes });
        return row;
      });
    const modeHelp = h('p', { class: 'setting-help', 'data-testid': 'setting-mode-help' });
    const coreRows = buildRows(CORE_SETTINGS);
    const settingsBody = h('div', { class: 'settings-grid' }, coreRows[0], modeHelp, ...coreRows.slice(1));
    const advanced = h(
      'details',
      { class: 'settings-advanced', 'data-testid': 'settings-advanced' },
      h('summary', {}, '고급'),
      h('div', { class: 'settings-grid' }, ...buildRows(ADVANCED_SETTINGS)),
    );
    const resetSettings = h('button', { type: 'button', class: 'link' }, '기본값으로 되돌리기');
    const settingsSummaryEl = h('span', { class: 'settings-summary', 'data-testid': 'settings-summary' });
    const settings = h(
      'details',
      { class: 'settings' },
      h('summary', {}, h('span', {}, '자동 제안 설정'), settingsSummaryEl),
      settingsBody,
      advanced,
      h('p', { class: 'muted small' }, '바꾸면 바로 다시 계산 (직접 고친 값은 유지)'),
      resetSettings,
    );

    const panel = h('aside', { class: 'panel' }, h('section', { class: 'scenario' }, empty, card), settings);
    const tools = this.buildDrawTools();
    const chartWrap = h('section', { class: 'chart-wrap', 'data-tools': tools.open ? 'open' : 'closed' }, tools.bar, chart, tools.hint, tools.edit.bar);
    tools.toggle.addEventListener('click', () => {
      const open = chartWrap.dataset.tools !== 'open';
      chartWrap.dataset.tools = open ? 'open' : 'closed';
      tools.toggle.textContent = open ? '‹' : '›';
      tools.toggle.title = open ? '작도 도구 접기' : '작도 도구 열기 (추세선·수평선·평행 채널·피보나치)';
      try {
        this.d.storage.setItem(DRAW_TOOLS_KEY, open ? 'open' : 'closed');
      } catch {
        // 무시
      }
      if (!open) this.chart.setTool(null);
    });
    const layout = h('main', { class: 'layout' }, chartWrap, panel);

    const toast = h('div', { class: 'toast', 'data-testid': 'toast', role: 'status', hidden: true });
    // 되돌리기 알림: 문구 + 되돌리기 버튼 + 5초 줄어드는 막대
    const undoText = h('span', { class: 'undo-text', 'data-testid': 'undo-text' });
    const undoBtn = h('button', { type: 'button', class: 'undo-btn', 'data-testid': 'undo-btn', title: '되돌리기 (Ctrl+Z)' }, '되돌리기');
    const undoBar = h('span', { class: 'undo-progress' });
    const undoRoot = h('div', { class: 'undo-bar', 'data-testid': 'undo-bar', role: 'status', hidden: true },
      h('div', { class: 'undo-row' }, undoText, undoBtn), h('div', { class: 'undo-track' }, undoBar));
    undoBtn.addEventListener('click', () => this.runUndo());
    const undo = { root: undoRoot, text: undoText, bar: undoBar };

    root.replaceChildren(topbar, loadError, layout, toast, undoRoot, tour.root);

    // 이벤트
    tf.addEventListener('change', () => {
      const t = tf.value as Timeframe;
      this.ui.timeframe = t;
      // 사용자가 고른 SL 기준은 유지 (고르지 않았으면 새 차트 시간봉 기준 기본값을 따라간다)
      if (this.ui.slBasis === this.defaultSlBasis()) this.ui.slBasis = undefined;
      void this.loadMarket();
    });
    sltf.addEventListener('change', () => void this.onSlBasisChange(sltf.value as Timeframe));
    long.addEventListener('click', () => void this.onSide('LONG'));
    short.addEventListener('click', () => void this.onSide('SHORT'));
    restore.addEventListener('click', () => {
      if (!this.scenario) return;
      this.scenario = restoreAuto(this.scenario);
      this.persist();
      this.renderNow(true);
    });
    del.addEventListener('click', () => this.clearCalc());
    resetSettings.addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      saveSettings(this.d.storage, this.settings);
      this.renderSettings();
      this.renderTopbar();
      this.renderNow();
      void this.recalcAuto();
    });
    // 선택한 작도나 박스는 Delete(또는 Backspace)로 지우기. 입력칸에서 글자를 지울 때는 무시. Esc는 도구·선택 취소
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.chart.getDrawState().tool) this.chart.setTool(null);
        this.chart.clearDrawingSelection();
        this.chart.clearSelection();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (this.deleteDrawingWithUndo()) {
        e.preventDefault();
        return;
      }
      if (!this.chart.isBoxSelected()) return;
      e.preventDefault();
      this.clearCalc();
    });
    // 되돌리기 알림이 떠 있는 동안 Ctrl+Z (⌘Z). 입력칸에서는 글자 되돌리기를 그대로 둔다
    document.addEventListener('keydown', (e) => {
      if (!this.undoAction || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      this.runUndo();
    });
    // TradingView처럼 Alt+R로 차트 보기 초기화. 한글 입력 상태에서도 되도록 e.code로 본다
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyR') return;
      e.preventDefault();
      this.chart.resetView();
    });

    return {
      picker, tf, sltf, long, short, status, statusReason, themeBtn,
      loadError, chart, empty, card, sideChip, title, entry, times, rr, rrInput, rrLabel, rrChips, reasons, bufferInput, bufferChips, bufferNote,
      sl, tp, slWhy, tpWhy, sizing, restore, del, settingsInputs, settingRows, modeHelp, settingsSummaryEl, toast, undo, tools, tour, flow,
    };
  }

  /** 차트 왼쪽 작도 도구: '›'를 누르면 펼쳐진다 */
  private buildDrawTools() {
    let open = false;
    try {
      open = this.d.storage.getItem(DRAW_TOOLS_KEY) === 'open';
    } catch {
      // 무시
    }
    const toggle = h(
      'button',
      { type: 'button', class: 'draw-toggle', 'data-testid': 'draw-toggle', title: open ? '작도 도구 접기' : '작도 도구 열기 (추세선·수평선·평행 채널·피보나치)' },
      open ? '‹' : '›',
    );
    const buttons = new Map<DrawingKind, HTMLButtonElement>();
    const list = h('div', { class: 'draw-tools' });
    for (const kind of DRAWING_KINDS) {
      const b = h('button', { type: 'button', class: 'draw-tool', 'data-testid': `draw-${kind}`, title: DRAWING_NAMES[kind], 'aria-label': DRAWING_NAMES[kind] });
      b.innerHTML = DRAW_ICONS[kind];
      b.addEventListener('click', () => this.chart.setTool(this.chart.getDrawState().tool === kind ? null : kind));
      buttons.set(kind, b);
      list.append(b);
    }
    const clear = h('button', {
      type: 'button', class: 'draw-tool danger', 'data-testid': 'draw-clear', title: '이 종목 작도 모두 지우기 (하나만 지우려면 눌러서 선택 후 Delete)', 'aria-label': '이 종목 작도 모두 지우기',
    });
    clear.innerHTML = DRAW_ICONS.clear;
    clear.addEventListener('click', () => {
      const sym = this.ui.symbol;
      const prev = [...(this.drawingsBySymbol[sym] ?? [])];
      if (prev.length === 0) return this.toast('지울 작도가 없습니다.');
      this.chart.setDrawings([]);
      delete this.drawingsBySymbol[sym];
      saveDrawings(this.d.storage, this.drawingsBySymbol);
      this.offerUndo(`${sym} 작도 ${prev.length}개를 지웠습니다`, () => this.restoreDrawings(sym, prev));
    });
    list.append(h('div', { class: 'draw-sep' }), clear);
    const bar = h('div', { class: 'draw-toolbar', 'data-testid': 'draw-toolbar' }, toggle, list);
    const hint = h('div', { class: 'draw-hint', 'data-testid': 'draw-hint', hidden: true });
    return { bar, toggle, buttons, hint, open, edit: this.buildDrawEdit() };
  }

  /** 선택한 작도 편집 막대: 색 견본·색 고르기·기본색·지우기 */
  private buildDrawEdit() {
    const name = h('span', { class: 'draw-edit-name', 'data-testid': 'draw-edit-name' });
    const swatches = DRAW_PALETTE.map((c) => {
      const b = h('button', { type: 'button', class: 'swatch', 'data-testid': 'draw-color-swatch', 'data-color': c, title: c, 'aria-label': `색 ${c}` });
      b.style.background = c;
      b.addEventListener('click', () => this.pickDrawColor(c));
      return b;
    });
    const custom = h('input', { type: 'color', class: 'swatch-custom', 'data-testid': 'draw-color-input', title: '직접 고르기' });
    custom.addEventListener('input', () => this.pickDrawColor(custom.value));
    const reset = h('button', { type: 'button', class: 'link small', 'data-testid': 'draw-color-reset', title: '기본색으로 (피보나치는 레벨별 색)' }, '기본색');
    reset.addEventListener('click', () => this.pickDrawColor(null));
    const del = h('button', { type: 'button', class: 'draw-tool danger', 'data-testid': 'draw-delete', title: '지우기 (Delete)', 'aria-label': '지우기' });
    del.innerHTML = DRAW_ICONS.clear;
    del.addEventListener('click', () => this.deleteDrawingWithUndo());
    const bar = h('div', { class: 'draw-edit', 'data-testid': 'draw-edit', hidden: true }, name, ...swatches, custom, reset, del);
    return { bar, name, swatches, custom };
  }

  private renderDrawEdit(d: Drawing | null): void {
    const e = this.el?.tools.edit;
    if (!e) return;
    show(e.bar, d !== null);
    if (!d) return;
    setText(e.name, DRAWING_NAMES[d.kind]);
    for (const b of e.swatches) b.classList.toggle('active', b.dataset.color?.toLowerCase() === d.color?.toLowerCase());
    e.custom.value = (d.color ?? DRAW_COLOR).toLowerCase();
  }

  /** 선택한 작도의 색을 바꾸고, 다음 작도의 기본색으로도 기억한다 (null = 기본색) */
  private pickDrawColor(color: string | null): void {
    const id = this.chart.selectedDrawingId();
    if (id) this.chart.setDrawingColor(id, color);
    this.chart.setDefaultDrawColor(color);
    try {
      if (color) this.d.storage.setItem(DRAW_COLOR_KEY, color);
      else this.d.storage.removeItem(DRAW_COLOR_KEY);
    } catch {
      // 무시
    }
  }

  private loadTheme(): ThemeMode {
    try {
      const v = this.d.storage.getItem(THEME_KEY);
      return isThemeMode(v) ? v : 'dark';
    } catch {
      return 'dark';
    }
  }

  /** 테마 적용: CSS(data-theme), 차트 색(THEME), 브라우저 상단 바 색, 버튼 글자. persist면 저장 */
  private setTheme(mode: ThemeMode, persist: boolean): void {
    this.themeMode = mode;
    setThemeMode(mode);
    document.documentElement.dataset.theme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME.bg);
    this.chart?.applyTheme();
    const btn = this.el?.themeBtn;
    if (btn) {
      const next = mode === 'dark' ? '라이트' : '다크';
      btn.replaceChildren(h('span', { class: 'icon', 'aria-hidden': 'true' }, mode === 'dark' ? '☀' : '☾'), h('span', { class: 'label' }, next));
      btn.title = `${next} 모드로 바꾸기`;
      btn.setAttribute('aria-label', `${next} 모드로 바꾸기`);
    }
    if (persist) {
      try {
        this.d.storage.setItem(THEME_KEY, mode);
      } catch {
        // 저장 못 해도 이번 화면에는 적용
      }
    }
    if (this.el && this.chart) this.renderNow(true);
  }

  /**
   * 버튼을 누르면 새 테마가 버튼 자리에서 원으로 퍼져 화면을 덮는다 (View Transitions).
   * 지원하지 않는 브라우저나 '동작 줄이기' 설정이면 바로 바뀐다. 저장은 누르는 즉시.
   */
  private switchTheme(from: HTMLElement): void {
    const next: ThemeMode = this.themeMode === 'dark' ? 'light' : 'dark';
    const doc = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reduce) {
      this.setTheme(next, true);
      return;
    }
    try {
      this.d.storage.setItem(THEME_KEY, next);
    } catch {
      // 저장 못 해도 이번 화면에는 적용
    }
    const r = from.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = doc.startViewTransition(() => this.setTheme(next, false));
    t.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 500, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        );
      })
      .catch(() => {
        // 전환이 건너뛰어져도 테마는 이미 바뀌었다
      });
  }

  private loadFeeTier(): FeeTier {
    try {
      const v = this.d.storage.getItem(FEE_TIER_KEY);
      return isFeeTier(v) ? v : DEFAULT_FEE_TIER;
    } catch {
      return DEFAULT_FEE_TIER;
    }
  }

  /** 수수료 등급 버튼: 고르면 저장하고 수수료 줄만 다시 계산 */
  private setFeeTier(tier: FeeTier): void {
    this.feeTier = tier;
    try {
      this.d.storage.setItem(FEE_TIER_KEY, tier);
    } catch {
      // 저장 못 해도 이번 화면에는 적용
    }
    this.renderNow();
  }

  private loadDrawColor(): string | null {
    try {
      const c = this.d.storage.getItem(DRAW_COLOR_KEY);
      return isColor(c) ? c : null;
    } catch {
      return null;
    }
  }

  private renderDrawTools(st: { tool: DrawingKind | null; placed: number }): void {
    const t = this.el?.tools;
    if (!t) return;
    for (const [kind, b] of t.buttons) b.classList.toggle('active', kind === st.tool);
    show(t.hint, st.tool !== null);
    setText(t.hint, st.tool ? `${placingHint(st.tool, st.placed)} · Esc 취소` : '');
  }

  /** 분할 진입: 입력(운영자산·손실 한도·분할 수·비중)은 상단 바, 분할별 금액표는 패널 */
  private buildSizing(field: (label: string, control: HTMLElement) => HTMLElement) {
    const capital = h('input', {
      'data-testid': 'sizing-capital', inputmode: 'decimal', autocomplete: 'off', placeholder: '예: 10000', 'aria-label': '운영자산 (USDT)',
    });
    const risk = h('input', { 'data-testid': 'sizing-risk', type: 'number', step: '0.1', min: '0.1', max: '10', 'aria-label': '손절 시 손실 (%)' });
    // 분할 수·비중은 직접 적는다. 예시 두 가지(점점 크게·손실 균등)는 비중 이름 옆 작은 버튼
    const splits = h('input', {
      // 그냥 적는 칸: 위아래 화살표·브라우저 자동완성 목록 없음
      'data-testid': 'sizing-splits', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '2',
      placeholder: '3', 'aria-label': '분할 수', title: `1~${MAX_SPLITS} 사이 숫자를 적으세요 (1 = 한 번에 진입)`,
    });
    const splitsField = h('label', { class: 'field' }, h('span', {}, '분할 진입'), h('span', { class: 'with-unit' }, splits, h('span', { class: 'unit' }, '분할')));
    const weights = h('input', {
      'data-testid': 'sizing-weights', autocomplete: 'off', spellcheck: 'false', placeholder: '예: 1:1:2', 'aria-label': '분할 비중',
      title: `1:1:2나 20/30/50처럼 적으면 칸 수가 분할 수 · '균등'을 적으면 분할별 손실 균등 · 최대 ${MAX_SPLITS}칸`,
    });
    const preset = (id: string, label: string, title: string) =>
      h('button', { type: 'button', class: 'weights-preset', 'data-testid': `sizing-weights-${id}`, title }, label);
    const linear = preset('linear', '점점 크게', '1:2:…:N (뒤로 갈수록 크게)');
    const equal = preset('equal', '손실 균등', '분할마다 SL 손실이 같게');
    const weightsField = h('div', { class: 'field' }, h('span', { class: 'weights-head' }, '비중', linear, equal), weights);
    const reason = h('p', { class: 'muted small', 'data-testid': 'sizing-reason' });
    const body = h('tbody');
    const table = h(
      'table',
      { class: 'sizing-table', 'data-testid': 'sizing-table' },
      h('thead', {}, h('tr', {}, ...['차수', '가격', '금액', '수량', '체결 시 평단'].map((t) => h('th', {}, t)))),
      body,
    );
    // 차트의 '체결 시 예상 평단' 점선 켜기/끄기
    const avgShow = h('input', { type: 'checkbox', 'data-testid': 'sizing-avg-toggle' });
    const avgToggle = h('label', { class: 'avg-toggle', title: '차트에 체결 시 예상 평단 점선 표시' }, avgShow, h('span', {}, '차트에 평단 선'));
    avgShow.addEventListener('change', () => {
      this.sizing = { ...this.sizing, showAvgLine: avgShow.checked };
      saveSizing(this.d.storage, this.sizing);
      this.renderNow();
    });
    const mk = (id: string) => h('dd', { class: 'num', 'data-testid': `sizing-${id}` });
    const sum = { total: mk('total'), lev: mk('lev'), fee: mk('fee'), loss: mk('loss'), profit: mk('profit'), avg: mk('avg'), rr: mk('rr') };
    // 손절 시 수수료가 손실에서 차지하는 몫: 한 줄 + 얇은 막대 (10% 미만 초록, 20% 미만 노랑, 그 이상 빨강)
    const feeFill = h('span', { class: 'fee-fill', 'data-testid': 'sizing-fee-fill' });
    // 설명(마우스를 올리면 보임)은 고른 등급의 수수료로 그릴 때마다 바꾼다
    const feeDt = h('dt', {}, '손절 시 수수료');
    // Bybit 수수료 등급 버튼 (일반 · VIP1~5). 고른 등급은 브라우저에 기억
    const feeTierBtns = FEE_TIERS.map((t) => {
      const b = h('button', { type: 'button', class: 'fee-tier', 'data-testid': 'fee-tier', 'data-tier': t, 'aria-pressed': 'false' }, FEE_RATES[t].label);
      b.addEventListener('click', () => this.setFeeTier(t));
      return b;
    });
    const feeRates = h('span', { class: 'fee-rates num', 'data-testid': 'fee-rates' });
    const feeTiers = h(
      'div',
      { class: 'fee-tier-row' },
      h('div', { class: 'fee-tiers', role: 'group', 'aria-label': 'Bybit 수수료 등급' }, ...feeTierBtns),
      feeRates,
    );
    // 금액은 윗줄, '손실의 몇 %'는 얇은 막대 오른쪽에 (한 줄이 길어져 줄바꿈되지 않게)
    const feeShare = h('span', { class: 'fee-share num', 'data-testid': 'sizing-fee-share' });
    const feeMeter = h(
      'div',
      { class: 'fee-row' },
      h('div', { class: 'fee-meter', 'aria-hidden': 'true' }, feeFill, h('span', { class: 'fee-tick', style: 'left: 20%' }), h('span', { class: 'fee-tick', style: 'left: 40%' })),
      feeShare,
    );
    sum.avg.classList.add('avg');
    const summary = h(
      'dl',
      { class: 'metrics', 'data-testid': 'sizing-summary' },
      h('dt', {}, '총 포지션'), sum.total,
      h('dt', {}, '필요 레버리지'), sum.lev,
      feeDt, sum.fee,
      feeMeter,
      feeTiers,
      h('dt', { class: 'group' }, '모두 체결되면'), h('dd', { class: 'group' }, avgToggle),
      // 강조 띠는 두 칸을 묶은 한 줄 (긴 이름이 왼쪽 칸 폭을 넓혀 숫자들이 줄바꿈되지 않게)
      h('div', { class: 'avg-row' }, h('dt', { class: 'avg' }, '전부 체결 시 예상 평단'), sum.avg),
      h('dt', {}, '손절 시'), sum.loss,
      h('dt', {}, '목표 시'), sum.profit,
      h('dt', {}, '손익비'), sum.rr,
    );
    const note = h(
      'p',
      { class: 'note' },
      '2차부터 진입~SL을 등간격으로 나눈 가격. 모두 체결된 뒤 SL에 맞아도 손실은 상단의 "손절 시 손실 %" 이하. 금액은 레버리지 전 포지션 규모(증거금 = 금액 ÷ 레버리지), 수량은 주문 단위로 내림.',
    );
    const bar = h(
      'div',
      { class: 'sizing-bar', 'data-testid': 'sizing-bar', id: 'sizing-bar' },
      field('운영자산 (USDT)', capital),
      field('손절 시 손실 %', risk),
      splitsField,
      weightsField,
    );
    // 폰 화면 전용: 입력칸 네 개를 한 줄 요약 버튼으로 접어 둔다 (데스크톱에서는 숨김, 입력칸은 항상 보임)
    const fold = h('button', {
      type: 'button', class: 'sizing-toggle', 'data-testid': 'sizing-toggle', 'aria-expanded': 'false', 'aria-controls': 'sizing-bar',
      'aria-label': '주문 설정 펼치기',
    });
    fold.addEventListener('click', () => {
      const open = bar.dataset.open !== 'true';
      bar.dataset.open = String(open);
      fold.setAttribute('aria-expanded', String(open));
    });
    const box = h(
      'section',
      { class: 'sizing panel-card', 'data-testid': 'sizing' },
      h('div', { class: 'level-head' }, h('span', { class: 'level-name' }, '주문표'), h('span', { class: 'muted small' }, '숫자를 누르면 복사')),
      reason,
      table,
      summary,
      note,
    );
    const apply = (src: 'capital' | 'risk' | 'splits' | 'weights' | 'linear' | 'equal') => {
      const cap = Number(capital.value.replace(/[,\s]/g, ''));
      const prev = this.sizing;
      let next: SizingSettings = { ...prev };
      if (src === 'splits') {
        const n = parseSplitCount(splits.value);
        if (n === null) {
          this.toast(`분할 수는 1~${MAX_SPLITS} 사이 정수로 적으세요 (1 = 한 번에 진입).`);
          this.renderSizingControls(true);
          return;
        }
        next = resizeSplits(prev, n);
      } else if (src === 'weights') {
        const r = readWeightsInput(weights.value, prev.splits);
        if (!r) {
          this.toast(`비중은 1:1:2나 20/30/50처럼 0보다 큰 숫자로 적으세요 (최대 ${MAX_SPLITS}칸, '균등' = 분할별 손실 균등).`);
          this.renderSizingControls(true);
          return;
        }
        next = { ...prev, ...r };
      } else if (src === 'linear' || src === 'equal') {
        next = { ...prev, weightMode: src === 'linear' ? 'linear' : 'equalRisk' };
      }
      this.sizing = sanitizeSizing({
        ...next,
        capital: capital.value.trim() === '' ? null : cap,
        riskPct: risk.value.trim() === '' ? undefined : Number(risk.value),
      });
      saveSizing(this.d.storage, this.sizing);
      this.renderSizingControls(true);
      this.renderNow(true);
    };
    capital.addEventListener('change', () => apply('capital'));
    risk.addEventListener('change', () => apply('risk'));
    splits.addEventListener('change', () => apply('splits'));
    weights.addEventListener('change', () => apply('weights'));
    linear.addEventListener('click', () => apply('linear'));
    equal.addEventListener('click', () => apply('equal'));
    for (const c of [capital, splits, weights]) c.addEventListener('keydown', (e) => e.key === 'Enter' && c.blur());
    return { bar, fold, box, capital, risk, splits, weights, linear, equal, reason, table, body, summary, sum, avgShow, feeFill, feeMeter, feeShare, feeDt, feeTierBtns, feeRates };
  }

  /** 상단 바의 분할 진입 입력칸을 저장된 값으로 맞춘다 (시나리오가 없어도 보인다) */
  private renderSizingControls(force: boolean): void {
    const z = this.el.sizing;
    const cfg = this.sizing;
    if (force || document.activeElement !== z.capital) z.capital.value = cfg.capital === null ? '' : String(cfg.capital);
    if (force || document.activeElement !== z.risk) z.risk.value = String(cfg.riskPct);
    if (force || document.activeElement !== z.splits) z.splits.value = String(cfg.splits);
    if (force || document.activeElement !== z.weights) z.weights.value = weightsText(cfg);
    // 지금 쓰는 예시 버튼 표시 (직접 입력한 비율이면 둘 다 꺼짐)
    z.linear.classList.toggle('active', cfg.weightMode === 'linear');
    z.equal.classList.toggle('active', cfg.weightMode === 'equalRisk');
    z.linear.title = `${ratioLabel(Math.max(cfg.splits, 2))} (뒤로 갈수록 크게)`;
    z.avgShow.checked = cfg.showAvgLine;
    // 폰 요약 버튼: '주문 설정 · 10,000 USDT · 1% · 3분할 1:2:3'
    const cap = cfg.capital === null ? '운영자산 입력' : `${cfg.capital.toLocaleString('en-US')} USDT`;
    const ratio = cfg.splits === 1 ? '1회 진입' : `${cfg.splits}분할 ${weightsText(cfg)}`;
    setText(z.fold, `${cap} · ${cfg.riskPct}% · ${ratio}`);
    z.fold.title = '주문 설정 (운영자산·손절 시 손실·분할·비중)';
  }

  private sizingPlan(s: Scenario): { plan: SizingPlan | null; reason: string | null } {
    const info = this.symbols.find((x) => x.symbol === s.symbol);
    const r = planSizing({
      side: s.side, entry: s.entry, sl: s.applied.sl, tp: s.applied.tp, tickSize: s.tickSize,
      qtyStep: info?.qtyStep, minQty: info?.minQty, minNotional: info?.minNotional, settings: this.sizing,
    });
    return r.ok ? { plan: r.plan, reason: null } : { plan: null, reason: r.reason };
  }

  /**
   * 누르면 복사되는 숫자 (value: 복사할 값, 표시와 다르면 지정. 금액은 쉼표 없이).
   * 복사하면 1.2초 동안 그 칸이 초록 + 왼쪽에 체크 (글자 자리는 그대로라 표가 흔들리지 않음)
   */
  private copyCell(text: string, what: string, value: string, key: string): HTMLElement {
    const on = this.copied !== null && this.copied.key === key && Date.now() < this.copied.until;
    const b = h(
      'button',
      { type: 'button', class: on ? 'copy copied' : 'copy', 'data-testid': 'copy', 'data-copy-key': key, title: on ? '복사됨' : `${what} 복사` },
      text,
    );
    b.addEventListener('click', () => this.copy(value, key));
    return b;
  }

  /** 주문표 줄 (1차·2차…: 가격·금액·수량은 누르면 복사, 체결 시 평단) */
  private renderSizingRows(s: Scenario, plan: SizingPlan, info: SymbolInfo | undefined, qd: number): void {
    this.el.sizing.body.replaceChildren(
      ...plan.tranches.map((t) => {
        const row = h(
          'tr',
          { 'data-testid': 'sizing-row', class: t.tooSmall ? 'too-small' : '' },
          h('td', {}, `${t.n}차 `, h('span', { class: 'muted small' }, `${(t.share * 100).toFixed(0)}%`)),
          h('td', { class: 'num' }, this.copyCell(formatPrice(t.price, s.tickSize), '가격', formatPrice(t.price, s.tickSize), `${t.n}-price`)),
          // 복사값 = 보이는 값에서 쉼표만 뺀 것 (toFixed와 표시 반올림이 반 센트에서 갈리지 않게)
          h('td', { class: 'num' }, this.copyCell(usdt(t.notional), '금액', usdt(t.notional).replace(/,/g, ''), `${t.n}-amount`)),
          h('td', { class: 'num' }, this.copyCell(t.qty.toFixed(qd), '수량', t.qty.toFixed(qd), `${t.n}-qty`)),
          // 1차부터 이 분할까지 체결됐을 때의 평단 (1차 = 진입가)
          h(
            'td',
            { class: `num stage-avg${t.n === plan.tranches.length && t.n > 1 ? ' final' : ''}`, 'data-testid': 'stage-avg' },
            formatPrice(snapToTick(t.avgIfFilled, s.tickSize), s.tickSize),
          ),
        );
        if (t.tooSmall) row.title = `거래소 최소 주문(수량 ${info?.minQty ?? '?'}, 금액 ${info?.minNotional ?? '?'} USDT) 미만`;
        return row;
      }),
    );
  }

  private renderSizing(s: Scenario): SizingPlan | null {
    const z = this.el.sizing;
    const { plan, reason } = this.sizingPlan(s);
    show(z.reason, reason !== null);
    setText(z.reason, reason ?? '');
    show(z.table, plan !== null);
    show(z.summary, plan !== null);
    if (!plan) return null;

    const info = this.symbols.find((x) => x.symbol === s.symbol);
    const qd = info?.qtyStep ? decimalsOf(info.qtyStep) : 4;
    const copiedKey = this.copied !== null && Date.now() < this.copied.until ? this.copied.key : '';
    const sig = JSON.stringify([
      s.tickSize,
      qd,
      info?.minQty,
      info?.minNotional,
      copiedKey,
      plan.tranches.map((t) => [t.n, t.share, t.price, t.notional, t.qty, t.avgIfFilled, t.tooSmall]),
    ]);
    // 시세가 올 때마다 표를 새로 만들면 누르는 사이(누름→뗌) 버튼이 바뀌어 복사 클릭이 사라진다 → 내용이 바뀔 때만
    if (sig !== this.sizingTableSig) {
      this.sizingTableSig = sig;
      this.renderSizingRows(s, plan, info, qd);
    }
    const lev = plan.leverage;
    setText(z.sum.total, `${usdt(plan.totalNotional)} USDT`);
    setText(z.sum.lev, lev > 1 ? `${(Math.ceil(lev * 10) / 10).toFixed(1)}배 이상` : '없음 (1배 이하)');
    const fee = feeAtStop(plan, this.feeTier);
    const rate = FEE_RATES[this.feeTier];
    const tierName = this.feeTier === 'vip0' ? 'Bybit 일반 등급' : `Bybit ${rate.label}`;
    const why = `전부 체결 후 손절 시: 지정가 진입 ${feePctText(rate.maker)} + 시장가 손절 ${feePctText(rate.taker)} (${tierName}). 막대 끝 = 50%`;
    z.feeDt.title = why;
    z.feeMeter.title = why;
    setText(z.feeRates, `지정가 ${feePctText(rate.maker)} · 시장가 ${feePctText(rate.taker)}`);
    for (const b of z.feeTierBtns) {
      const on = b.dataset.tier === this.feeTier;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const zone = fee.sharePct === null ? '' : fee.sharePct < 10 ? 'low' : fee.sharePct < 20 ? 'mid' : 'high';
    setText(z.sum.fee, `${usdt(fee.fee)} USDT`);
    setText(z.feeShare, fee.sharePct === null ? '' : `손실의 ${fee.sharePct.toFixed(0)}%`);
    z.sum.fee.dataset.zone = zone;
    z.feeShare.dataset.zone = zone;
    z.feeFill.dataset.zone = zone;
    z.feeFill.style.width = `${Math.min(100, ((fee.sharePct ?? 0) / 50) * 100)}%`;
    setText(z.sum.loss, `−${usdt(plan.lossAtSl)} (−${plan.lossPct.toFixed(2)}%)`);
    setText(z.sum.profit, plan.profitAtTp === null ? '—' : `+${usdt(plan.profitAtTp)} (+${plan.profitPct!.toFixed(2)}%)`);
    setText(z.sum.avg, formatPrice(plan.avgEntry, s.tickSize));
    setText(z.sum.rr, plan.rr === null ? '—' : formatRR(plan.rr));
    return plan;
  }

  /** SL 여유(%)를 바꾸고 지금 계산의 자동 SL을 다시 계산 (직접 옮긴 SL은 그대로) */
  private async setSlBuffer(pct: number): Promise<void> {
    this.settings = sanitizeSettings({ ...this.settings, slBufferPct: pct });
    saveSettings(this.d.storage, this.settings);
    this.renderSettings();
    this.renderNow();
    await this.recalcAuto();
  }

  private async applySettings(changed: keyof AnalysisSettings): Promise<void> {
    // 설정 칸에 없는 값(SL 여유 등)은 지금 값을 그대로 둔다
    const raw: Record<string, unknown> = { ...this.settings };
    for (const [key, control] of this.el.settingsInputs) {
      raw[key] = control instanceof HTMLSelectElement ? control.value : Number(control.value);
    }
    this.settings = sanitizeSettings(raw);
    saveSettings(this.d.storage, this.settings);
    this.renderSettings();
    this.renderTopbar();
    this.renderNow();
    if (ANALYSIS_KEYS.includes(changed)) await this.recalcAuto();
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
    e.picker.setValue(this.ui.symbol);
    e.flow.setCurrent(this.ui.symbol);
    e.tf.value = this.ui.timeframe;
    // SL 기준: 모든 SL 방식에서 고를 수 있다. 차트와 같은 시간봉에는 '(차트)' 표시
    // 폰은 칸이 좁아 차트와 같은 시간봉을 '차트와 같음'으로 짧게 (옆 칸이 차트 시간봉)
    const chartMark = (t: Timeframe) => (PHONE.matches ? '차트와 같음' : `${tfName(t)} (차트)`);
    e.sltf.replaceChildren(
      ...TIMEFRAMES.map((t) => h('option', { value: t }, t === this.ui.timeframe ? chartMark(t) : tfName(t))),
    );
    e.sltf.value = this.currentSlTf();
    e.sltf.title = 'SL을 계산할 시간봉 (예: 15분봉 차트에서 1시간봉 스윙 저점). 바꾸면 지금 계산의 자동 SL도 다시 계산';
    this.renderSizingControls(false);
    show(e.loadError, this.loadError !== null);
    setText(e.loadError, this.loadError ?? '');
  }

  private renderSettings(): void {
    const e = this.el;
    for (const [key, control] of e.settingsInputs) control.value = String(this.settings[key]);
    // 고른 SL 방식에 해당하는 숫자 칸만 보이기
    for (const { row, modes } of e.settingRows.values()) show(row, !modes || modes.includes(this.settings.slMode));
    setText(e.modeHelp, SL_MODE_HELP[this.settings.slMode]);
    setText(e.settingsSummaryEl, settingsSummary(this.settings));
    this.renderSlBuffer();
  }

  /** 손절 줄 아래 SL 여유: 입력칸·칩, 직접 옮긴 SL이면 안내, SL이 헌팅존 안이면 경고 */
  private renderSlBuffer(): void {
    const e = this.el;
    const v = this.settings.slBufferPct;
    if (document.activeElement !== e.bufferInput) e.bufferInput.value = String(v);
    for (const b of e.bufferChips) {
      const on = Number(b.dataset.pct) === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const s = this.scenario;
    const hunt = s ? this.huntZoneFor(s) : null;
    const note = !s ? '' : s.source.sl === 'manual' ? '직접 옮긴 SL은 그대로' : hunt?.slInside ? '💀 SL이 헌팅존 안' : '';
    setText(e.bufferNote, note);
    e.bufferNote.dataset.kind = !note ? '' : s?.source.sl === 'manual' ? 'manual' : 'hunt';
  }

  private renderStatus(): void {
    if (!this.el) return;
    const f = this.freshness();
    const labels: Record<Freshness['status'], string> = {
      live: '실시간',
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
    const s = this.scenario && this.scenario.symbol === this.ui.symbol ? this.scenario : null;
    show(e.empty, !s);
    show(e.card, !!s);
    if (!s) {
      this.chart.setOverlay(null);
      return;
    }

    const m = this.metricsFor(s);
    const tick = s.tickSize;
    const fp = (p: number | null) => (p === null ? '—' : formatPrice(p, tick));

    e.sideChip.className = `side-chip ${s.side === 'LONG' ? 'long' : 'short'}`;
    setText(e.sideChip, s.side);
    setText(e.title, `${s.symbol} · ${tfName(s.timeframe)}`);
    setText(
      e.times,
      s.entryManual
        ? `지정가로 계산 (누를 때 시장가 ${fp(s.capturedEntry ?? s.entry)})`
        : `${formatClock(s.priceTime)} ${s.priceSource === 'trade' ? '체결가' : '티커 가격'}로 계산`,
    );
    if (force || document.activeElement !== e.rrInput) {
      e.rrInput.value = m.rr === null ? '' : formatRR(m.rr).slice(2);
      e.rrInput.style.width = `${Math.max(2, e.rrInput.value.length) + 0.4}ch`;
    }
    const rrNow = e.rrInput.value;
    // 지금 손익비와 같은 칩을 켜고, SL이 진입가 반대편에 없어 TP를 정할 수 없으면 칩을 잠근다
    const rrCan = tpForRR(s.side, s.entry, s.applied.sl, 1, tick) !== null;
    const rrShown = m.rr === null ? null : formatRR(m.rr);
    for (const b of e.rrChips) {
      const on = rrShown === `1:${b.dataset.rr}`;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !rrCan;
    }
    setText(e.rrLabel, this.sizing.splits > 1 ? '손익비 (1차만 체결 시)' : '손익비');
    e.rr.dataset.valid = String(m.valid);
    e.reasons.replaceChildren(...m.reasons.map((r) => h('li', {}, r)));

    const rows = { entry: e.entry, sl: e.sl, tp: e.tp } as const;
    const values = { entry: s.entry, sl: s.applied.sl, tp: s.applied.tp };
    for (const which of ['entry', 'sl', 'tp'] as const) {
      const row = rows[which];
      const value = values[which];
      if (force || document.activeElement !== row.input) row.input.value = value === null ? '' : formatPrice(value, tick);
    }
    setText(e.entry.pct, '');
    setText(e.sl.pct, m.riskPct === null ? '' : `−${formatPct(m.riskPct)}`);
    setText(e.tp.pct, m.rewardPct === null ? '' : `+${formatPct(m.rewardPct)}`);
    setText(e.entry.badge, s.entryManual ? '지정가' : '시장가');
    e.entry.badge.dataset.source = s.entryManual ? 'manual' : 'auto';
    for (const which of ['sl', 'tp'] as const) {
      setText(rows[which].badge, s.source[which] === 'manual' ? '수동' : '자동');
      rows[which].badge.dataset.source = s.source[which];
    }
    setText(e.slWhy, slRationale(s.auto.sl, s.side));
    this.renderSlBuffer();
    setText(e.tpWhy, tpRationale(s.auto.tp, s.side));
    const plan = this.renderSizing(s);
    this.rollChanged(s.id, rrNow);

    const profit = m.rewardDist === null ? null : `목표 +${fp(m.rewardDist)} (${formatPct(m.rewardPct!)})`;
    const loss = m.riskDist === null ? null : `손절 −${fp(m.riskDist)} (${formatPct(m.riskPct!)})`;
    const center = m.valid ? `손익비 ${formatRR(m.rr!)}` : m.reasons[0] ?? '';

    const overlay: OverlayInput = {
      side: s.side,
      entry: s.entry,
      sl: s.applied.sl,
      tp: s.applied.tp,
      startTime: s.priceTime,
      endTime: null,
      extendBars: this.settings.boxExtendBars,
      draggable: true,
      labels: { profit, loss, center, centerValid: m.valid },
      // SL 캔들보다 큰 시간봉 차트에서는 띠가 실제보다 넓어 보이므로 그리지 않는다
      slCandle: s.auto.sl.candle && tfMs(s.auto.sl.timeframe) >= tfMs(this.ui.timeframe)
        ? {
            time: s.auto.sl.candle.time,
            durationMs: barEnd(s.auto.sl.timeframe, s.auto.sl.candle.time) - s.auto.sl.candle.time,
            label: slBandLabel(s.auto.sl, s.side, this.ui.timeframe),
          }
        : null,
      presets: rrLevels(s.side, s.entry, s.applied.sl, s.tickSize),
      splits: plan ? plan.tranches.slice(1).map((t) => ({ price: t.price, label: `${t.n}차 ${(t.share * 100).toFixed(0)}%` })) : [],
      // 분할별 체결 시 예상 평단: 2차 체결 시 … 전부 체결 시 (1차 체결 시 = 진입가라 따로 그리지 않음)
      avgLines:
        this.sizing.showAvgLine && plan && plan.tranches.length > 1
          ? plan.tranches.slice(1).map((t) => {
              const price = snapToTick(t.avgIfFilled, s.tickSize);
              const final = t.n === plan.tranches.length;
              const p = formatPrice(price, s.tickSize);
              return { price, final, label: `${final ? '전부' : `${t.n}차`} 체결 시 평단 ${p}`, short: `${final ? '전부' : `${t.n}차`} ${p}` };
            })
          : [],
      shiftBars: boxShiftOf(s),
      huntZone: this.huntZoneFor(s),
    };
    this.chart.setOverlay(overlay);
  }

  /** SL 기준 꼬리 끝(자동 SL을 고른 캔들의 저가·고가)에서 2~10% 바깥. 지금 SL이 그 안이면 이름표가 경고로 */
  private huntZoneFor(s: Scenario): OverlayInput['huntZone'] {
    const c = s.auto.sl.candle;
    const wick = c ? (s.side === 'LONG' ? c.low : c.high) : null;
    // SL을 직접 옮기면 구간도 같은 비율로 따라간다 (자동 SL일 때는 꼬리 끝 기준 그대로)
    const tip = huntTip(s.side, s.source.sl, s.applied.sl, wick, s.auto.sl.bufferPct ?? 0);
    if (tip === null) return null;
    const z = huntZone(s.side, tip, s.entry);
    if (!z) return null;
    const slInside = s.applied.sl !== null && inHuntZone(z, s.applied.sl);
    const label = slInside ? '스탑헌팅존 · SL이 안에 있음' : `스탑헌팅존 ${HUNT_NEAR_PCT}~${HUNT_FAR_PCT}%`;
    return { ...z, label, slInside };
  }

  /** E2E 검증용 읽기 전용 정보 */
  debugApi() {
    return {
      getScenario: () => (this.scenario ? structuredClone(this.scenario) : null),
      getLastCopied: () => this.lastCopied,
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
      getTheme: () => this.themeMode,
      chartBackground: () => this.chart.backgroundColor(),
      legendBottom: () => this.chart.legendBottom(),
      getOverlayLabels: () => this.chart.getOverlayLabels(),
      isBoxSelected: () => this.chart.isBoxSelected(),
      getDrawings: () => this.chart.getDrawings(),
      getDrawState: () => this.chart.getDrawState(),
      drawLineWidth: () => DRAW_LINE_WIDTH,
      wickColors: () => this.chart.wickColors(),
      timeToX: (ms: number) => this.chart.timeToX(ms),
      getMaLast: () => this.chart.getMaLast(),
      getLegend: () => this.chart.getLegend(),
      getRecentCloses: (n: number) => this.store.all().slice(-n).map((c) => c.close),
      /** 마지막 캔들과 최신 가격을 같은 순간에 읽는다 */
      getLiveSnapshot: () => ({ lastCandle: this.store.last() ?? null, lastPrice: this.feed.lastPrice }),
      priceToClientY: (p: number) => this.chart.priceToClientY(p),
      getFeedStatus: () => this.freshness().status,
    };
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
