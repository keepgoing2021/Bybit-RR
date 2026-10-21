import { baseName, FLOW_WINDOW_MIN, FlowBook, type FlowRow } from '../core/flow';
import { formatTurnover } from '../core/symbolSearch';
import type { MarketDataProvider } from '../data/provider';
import { h, setText, show } from './dom';

/** 폰이 아닐 때만 보이고(styles.css의 641px 구간과 같은 기준), 그때만 전 종목 1분봉을 받는다 */
export const FLOW_MEDIA = '(min-width: 641px)';

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
 * 우측 위 '5분 순위판': Bybit 전 종목의 최근 5분 거래대금 TOP3와 상승률 TOP3.
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
  private current = '';
  private source: { provider: MarketDataProvider; symbols: string[] } | null = null;
  private readonly media: MediaQueryList | null;
  private observer: ResizeObserver | null = null;
  private frame = 0;

  constructor(
    private readonly onPick: (symbol: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.coverage = h('span', { class: 'flow-coverage', 'data-testid': 'flow-coverage' });
    const list = (id: string) => h('ol', { class: 'flow-list', 'data-testid': id });
    this.lists = { volume: list('flow-volume'), gainers: list('flow-gainers') };
    this.root = h(
      'div',
      { class: 'flow', 'data-testid': 'flow', title: 'Bybit USDT 무기한 전 종목의 최근 5분 (1분봉 5개)' },
      h(
        'div',
        { class: 'flow-col' },
        h('div', { class: 'flow-col-head' }, h('b', {}, '5분 거래대금'), h('span', { class: 'flow-src' }, 'Bybit')),
        this.lists.volume,
      ),
      h('div', { class: 'flow-col' }, h('div', { class: 'flow-col-head' }, h('b', {}, '5분 상승률'), this.coverage), this.lists.gainers),
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
    }
    this.watchLayout();
    this.place();
  }

  private halt(): void {
    this.stop?.();
    this.stop = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
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
    this.coverage.title = partial ? `연결 직후라 아직 ${r.coverageMin}분치만 모였습니다 (5분이 차면 사라집니다)` : '';
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
          { type: 'button', class: `flow-row${x.symbol === this.current ? ' current' : ''}`, 'data-symbol': x.symbol, 'data-testid': 'flow-row', title: `${x.symbol} 차트 보기` },
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
