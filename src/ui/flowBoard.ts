import { baseName, FLOW_SPIKE_MIN_TURNOVER, FLOW_SPIKE_RATIO, FLOW_WINDOW_MIN, FlowBook, type FlowRow } from '../core/flow';
import { formatTurnover } from '../core/symbolSearch';
import type { MarketDataProvider } from '../data/provider';
import { h, setText, show } from './dom';

/** 폰이 아닐 때만 보이고(styles.css의 641px 구간과 같은 기준), 그때만 전 종목 1분봉을 받는다 */
export const FLOW_MEDIA = '(min-width: 641px)';

/**
 * 연결 직후 15분을 기다리지 않게: 24시간 거래대금 상위 몇 종목은 지난 1분봉을 REST로 미리 받아 채운다
 * (웹소켓은 이번 1분 봉부터 보내 준다). 동시에 몇 개씩 받을지
 */
export const FLOW_BACKFILL_SYMBOLS = 40;
const FLOW_BACKFILL_PARALLEL = 4;
/** 24시간 거래대금(평소 거래대금 기준)을 다시 받는 간격 (ms) */
export const FLOW_USUAL_REFRESH_MS = 5 * 60_000;

/** 상단 바 오른쪽 빈 자리에 둘 때 판 너비 (px): 이보다 자리가 좁으면 바 끝에 이어 붙인다 */
export const FLOW_SIDE_MAX_W = 300;
export const FLOW_SIDE_MIN_W = 256;
/** 두 줄형(거래대금 한 줄 + 상승률 한 줄) 너비: 바가 한 줄이라 낮을 때 바를 늘리지 않으려고 */
export const FLOW_WIDE_MAX_W = 460;
export const FLOW_WIDE_MIN_W = 360;
/** 판과 다른 칸 사이 간격, 판 위아래 여백 (px) */
const FLOW_GAP = 14;
const FLOW_INSET = 8;

/**
 * 우측 위 '15분 순위판': Bybit 전 종목의 최근 15분 거래대금 TOP3, 그리고 평소보다 거래대금이 2배 이상 붙은 종목 중 15분 상승률 TOP3.
 * 줄을 누르면 그 종목 차트로 바꾼다.
 *
 * 자리: 상단 바의 다른 칸 오른쪽에 판이 들어갈 빈 자리가 있으면 그 오른쪽 끝에 겹쳐 둔다(side).
 * 모양: 바 높이 안에 들어가면 두 칸형(stacked: 거래대금 | 상승률, 각 3줄), 바가 한 줄이라 낮으면
 * 두 줄형(wide: 거래대금 3개가 한 줄, 상승률 3개가 한 줄)으로 바꿔 바를 늘리지 않는다 (늘리면 로고 줄이 내려앉음).
 * 그래도 안 들어가면 바를 판 높이만큼 늘린다. 자리가 없으면(좁은 창) 두 줄형으로 바의 마지막 줄 끝에 이어 붙인다(inline).
 * 화면 폭 기준(미디어 쿼리)이 아니라 실제로 잰 자리로 정하므로 윈도우 배율·글꼴이 달라도 겹치거나 잘리지 않는다.
 */
export class FlowBoard {
  readonly root: HTMLDivElement;
  private readonly book = new FlowBook();
  private readonly coverage: HTMLSpanElement;
  private readonly lists: { volume: HTMLOListElement; gainers: HTMLOListElement };
  private stop: (() => void) | null = null;
  private timer: number | null = null;
  private usualTimer: number | null = null;
  private current = '';
  private source: { provider: MarketDataProvider; symbols: string[] } | null = null;
  private readonly media: MediaQueryList | null;
  private observer: ResizeObserver | null = null;
  private frame = 0;
  /** 시작할 때마다 하나씩 올림: 늦게 도착한 미리 채우기 결과를 버리려고 */
  private gen = 0;

  constructor(
    private readonly onPick: (symbol: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.coverage = h('span', { class: 'flow-coverage', 'data-testid': 'flow-coverage' });
    const list = (id: string) => h('ol', { class: 'flow-list', 'data-testid': id });
    this.lists = { volume: list('flow-volume'), gainers: list('flow-gainers') };
    this.root = h(
      'div',
      { class: 'flow', 'data-testid': 'flow', title: `Bybit USDT 무기한 전 종목의 최근 ${FLOW_WINDOW_MIN}분 (1분봉 ${FLOW_WINDOW_MIN}개)` },
      h(
        'div',
        { class: 'flow-col' },
        h('div', { class: 'flow-col-head' }, h('b', {}, `${FLOW_WINDOW_MIN}분 거래대금`), h('span', { class: 'flow-src' }, 'Bybit')),
        this.lists.volume,
      ),
      h(
        'div',
        { class: 'flow-col' },
        h(
          'div',
          { class: 'flow-col-head', title: `거래가 터지면서 오르는 코인: ${FLOW_WINDOW_MIN}분 거래대금이 평소의 ${FLOW_SPIKE_RATIO}배 이상(그리고 ${formatTurnover(FLOW_SPIKE_MIN_TURNOVER)} USDT 이상)인 종목 중 많이 오른 순. 평소 = 24시간 거래대금의 같은 시간 평균` },
          h('b', {}, `${FLOW_WINDOW_MIN}분 상승률`),
          this.coverage,
        ),
        this.lists.gainers,
      ),
    );
    this.root.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('button[data-symbol]') as HTMLButtonElement | null;
      if (row) this.onPick(row.dataset.symbol!);
    });
    this.media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(FLOW_MEDIA) : null;
    this.media?.addEventListener?.('change', () => this.sync());
  }

  /** 시세 공급원·종목 목록이 정해지면 (다시) 시작. 폰이면 받지 않는다 */
  start(provider: MarketDataProvider, symbols: string[]): void {
    this.source = { provider, symbols };
    this.sync();
  }

  setCurrent(symbol: string): void {
    if (this.current === symbol) return;
    this.current = symbol;
    this.render();
  }

  private sync(): void {
    this.halt();
    const src = this.source;
    const visible = !!src && !!src.provider.watchFlow && src.symbols.length > 0 && (this.media?.matches ?? false);
    show(this.root, !!src?.provider.watchFlow);
    if (visible && src?.provider.watchFlow) {
      this.book.clear();
      this.stop = src.provider.watchFlow(src.symbols, (s, b, at) => this.book.update(s, b, at));
      this.timer = window.setInterval(() => this.render(), 1_000);
      this.render();
      void this.backfill(src.provider, src.symbols, this.gen);
      const provider = src.provider;
      const gen = this.gen;
      this.usualTimer = window.setInterval(() => void this.refreshUsual(provider, gen), FLOW_USUAL_REFRESH_MS);
    }
    this.watchLayout();
    this.place();
  }

  /** 24시간 거래대금 상위 종목의 지난 1분봉을 미리 채운다 (실패하면 그냥 웹소켓으로 차오르길 기다린다) */
  private async backfill(provider: MarketDataProvider, symbols: string[], gen: number): Promise<void> {
    let tickers;
    try {
      tickers = await provider.fetchTickers();
    } catch {
      return;
    }
    if (gen !== this.gen) return;
    this.book.setUsual(tickers);
    const listed = new Set(symbols);
    const queue = tickers
      .filter((t) => listed.has(t.symbol))
      .sort((a, b) => b.turnover24h - a.turnover24h)
      .slice(0, FLOW_BACKFILL_SYMBOLS)
      .map((t) => t.symbol);
    const worker = async () => {
      while (queue.length && gen === this.gen) {
        const symbol = queue.shift()!;
        try {
          const { candles } = await provider.fetchCandles(symbol, '1', FLOW_WINDOW_MIN + 1);
          if (gen !== this.gen) return;
          // 웹소켓으로 이미 받은 봉(같은 시작 시각)은 덮지 않는다 — 더 최신이다
          for (const c of candles) {
            if (!this.book.has(symbol, c.time)) this.book.update(symbol, { start: c.time, open: c.open, close: c.close, turnover: c.turnover ?? 0 });
          }
        } catch {
          // 한 종목 실패는 무시
        }
      }
    };
    await Promise.all(Array.from({ length: FLOW_BACKFILL_PARALLEL }, worker));
    if (gen === this.gen) this.render();
  }

  /** 평소 거래대금 기준(24시간 거래대금)을 새로 받는다 (실패하면 이전 값 그대로) */
  private async refreshUsual(provider: MarketDataProvider, gen: number): Promise<void> {
    try {
      const tickers = await provider.fetchTickers();
      if (gen === this.gen) this.book.setUsual(tickers);
    } catch {
      // 다음 번에 다시
    }
  }

  private halt(): void {
    // 진행 중인 미리 채우기도 멈춘다 (다른 공급원·화면 폭으로 다시 시작할 때 섞이지 않게)
    this.gen++;
    this.stop?.();
    this.stop = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.usualTimer !== null) window.clearInterval(this.usualTimer);
    this.usualTimer = null;
  }

  /** 상단 바나 그 칸들의 크기가 바뀌면(창 크기, 글꼴, 연결 상태 문구 등) 자리를 다시 잰다 */
  private watchLayout(): void {
    const bar = this.root.parentElement;
    if (this.observer || !bar || typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver(() => {
      // 관찰 콜백 안에서 바로 크기를 바꾸면 관찰 루프 경고가 나므로 다음 프레임에
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.place());
    });
    this.observer.observe(bar);
    for (const c of bar.children) if (c !== this.root) this.observer.observe(c);
  }

  private place(): void {
    const bar = this.root.parentElement;
    if (!bar) return;
    const on = !this.root.hidden && (this.media?.matches ?? false);
    const root = this.root;
    if (!on) {
      delete root.dataset.place;
      delete root.dataset.layout;
      root.style.width = '';
      bar.style.minHeight = '';
      return;
    }
    // 판 없이 바가 원래 차지하는 높이를 재려고 늘린 높이를 먼저 푼다 (한 번에 다시 정하므로 화면이 흔들리지 않는다)
    bar.style.minHeight = '';
    const b = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    const left = b.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    const right = b.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
    // 다른 칸들이 차지한 가장 오른쪽 (판은 바 높이 전체에 걸치므로 모든 줄을 본다)
    let used = left;
    for (const c of bar.children) {
      if (c === root) continue;
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) used = Math.max(used, r.right);
    }
    const room = Math.floor(right - used - FLOW_GAP);
    const set = (place: 'side' | 'inline', layout: 'stacked' | 'wide', width: number | null) => {
      root.dataset.place = place;
      root.dataset.layout = layout;
      root.style.width = width === null ? '' : `${width}px`;
    };
    if (room >= FLOW_SIDE_MIN_W) {
      // 바 테두리 안쪽 높이 (판은 그 안에서 위아래 여백을 두고 가운데)
      const inner = bar.clientHeight;
      const fits = () => root.offsetHeight + 2 * FLOW_INSET <= inner;
      set('side', 'stacked', Math.min(FLOW_SIDE_MAX_W, room));
      if (fits()) return;
      if (room >= FLOW_WIDE_MIN_W) {
        set('side', 'wide', Math.min(FLOW_WIDE_MAX_W, room));
        if (fits()) return;
      }
      // 어느 모양도 바 안에 안 들어가면 판 높이만큼 바를 늘린다 (줄은 위에 붙어 있어 로고는 그대로)
      bar.style.minHeight = `${root.offsetHeight + 2 * FLOW_INSET + (bar.offsetHeight - bar.clientHeight)}px`;
      return;
    }
    // 좁은 창: 두 줄형으로 마지막 줄 끝에 (자리가 없으면 새 줄) — 세 줄짜리 두 칸형보다 덜 높다
    set('inline', 'wide', Math.min(FLOW_WIDE_MAX_W, Math.floor(right - left)));
  }

  private render(): void {
    const r = this.book.rank(this.now());
    const partial = r.coverageMin < FLOW_WINDOW_MIN;
    setText(this.coverage, r.coverageMin === 0 ? '받는 중' : partial ? `${r.coverageMin}/${FLOW_WINDOW_MIN}분` : '');
    this.coverage.title = partial ? `연결 직후라 아직 ${r.coverageMin}분치만 모였습니다 (${FLOW_WINDOW_MIN}분이 차면 사라집니다)` : '';
    this.fill(this.lists.volume, r.volume, (x) => formatTurnover(x.turnover), '');
    this.fill(this.lists.gainers, r.gainers, (x) => `+${x.changePct.toFixed(2)}%`, 'up');
  }

  private fill(ol: HTMLOListElement, rows: FlowRow[], value: (r: FlowRow) => string, cls: string): void {
    const items = rows.map((x, i) =>
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', class: `flow-row${x.symbol === this.current ? ' current' : ''}`, 'data-symbol': x.symbol, 'data-testid': 'flow-row', title: rowTitle(x) },
          h('span', { class: 'flow-rank' }, String(i + 1)),
          h('span', { class: 'flow-name' }, baseName(x.symbol)),
          h('span', { class: `flow-value num ${cls}` }, value(x)),
        ),
      ),
    );
    if (!items.length) items.push(h('li', { class: 'flow-empty' }, '—'));
    ol.replaceChildren(...items);
  }
}

/** 줄에 마우스를 올리면: 15분 거래대금(평소의 몇 배)·상승률 */
function rowTitle(x: FlowRow): string {
  const spike = x.spike !== undefined ? ` (평소의 ${x.spike.toFixed(1)}배)` : '';
  const change = `${x.changePct >= 0 ? '+' : ''}${x.changePct.toFixed(2)}%`;
  return `${x.symbol} · ${FLOW_WINDOW_MIN}분 거래대금 ${formatTurnover(x.turnover)} USDT${spike} · ${change} — 눌러서 차트 보기`;
}
