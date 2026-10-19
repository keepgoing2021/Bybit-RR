import { baseName, FLOW_WINDOW_MIN, FlowBook, type FlowRow } from '../core/flow';
import { formatTurnover } from '../core/symbolSearch';
import type { MarketDataProvider } from '../data/provider';
import { h, setText, show } from './dom';

/** 넓은 화면(상단 바 오른쪽에 자리가 있을 때)에서만 보이고, 그때만 전 종목 1분봉을 받는다 */
export const FLOW_MEDIA = '(min-width: 1320px)';

/**
 * 우측 위 '5분 순위판': Bybit 전 종목의 최근 5분 거래대금 TOP3와 상승률 TOP3.
 * 줄을 누르면 그 종목 차트로 바꾼다.
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
      h('div', { class: 'flow-head' }, h('b', {}, '5분 순위'), h('span', { class: 'flow-src' }, 'Bybit'), this.coverage),
      h('div', { class: 'flow-cols' },
        h('div', { class: 'flow-col' }, h('span', { class: 'flow-col-title' }, '거래대금'), this.lists.volume),
        h('div', { class: 'flow-col' }, h('span', { class: 'flow-col-title' }, '상승률'), this.lists.gainers),
      ),
    );
    this.root.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('button[data-symbol]') as HTMLButtonElement | null;
      if (row) this.onPick(row.dataset.symbol!);
    });
    this.media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(FLOW_MEDIA) : null;
    this.media?.addEventListener?.('change', () => this.sync());
  }

  /** 시세 공급원·종목 목록이 정해지면 (다시) 시작. 화면이 좁으면 받지 않는다 */
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
    if (!visible || !src?.provider.watchFlow) return;
    this.book.clear();
    this.stop = src.provider.watchFlow(src.symbols, (s, b, at) => this.book.update(s, b, at));
    this.timer = window.setInterval(() => this.render(), 1_000);
    this.render();
  }

  private halt(): void {
    this.stop?.();
    this.stop = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private render(): void {
    const r = this.book.rank(this.now());
    setText(this.coverage, r.coverageMin === 0 ? '받는 중…' : r.coverageMin < FLOW_WINDOW_MIN ? `집계 ${r.coverageMin}/${FLOW_WINDOW_MIN}분` : '');
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
