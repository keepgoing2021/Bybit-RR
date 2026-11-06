import { formatPrice } from '../core/price';
import { formatTurnover } from '../core/symbolSearch';
import type { SymbolInfo, TickerStat } from '../core/types';
import { bybitBase, type CoinMeta } from '../core/coinMeta';
import { buildGroups, nextSort, parseFavorites, parseSort, tickDirection, toggleFavorite, type WatchRow, type WatchSort, type WatchSortKey } from '../core/watchlist';
import type { StorageLike } from '../core/persistence';
import { h, setText, show } from './dom';

/** 시세를 다시 받는 간격. 목록이 보이고 탭이 앞에 있을 때만 받는다 (Bybit 전 종목 시세 한 번 = 요청 하나) */
const REFRESH_MS = 3_000;
const FAV_KEY = 'rrtool.v1.favorites';
const SORT_KEY = 'rrtool.v1.watchsort';
const FOLD_KEY = 'rrtool.v1.watchfold';

const COLS: [WatchSortKey, string][] = [
  ['symbol', '종목'],
  ['price', '현재가'],
  ['change', '변동%'],
  ['turnover', '거래대금'],
];

interface RowEls {
  row: HTMLDivElement;
  star: HTMLButtonElement;
  price: HTMLSpanElement;
  change: HTMLSpanElement;
  turnover: HTMLSpanElement;
  icon: HTMLSpanElement;
  ko: HTMLElement;
  tags: HTMLSpanElement;
  metaKey?: string;
  last?: number;
  flashTimer?: number;
}

/**
 * 종목 리스트 (2026-11-05, 사용자 요청: 「종목 나열」). 즐겨찾기 묶음 + 전체, 칸 이름으로 정렬,
 * 가격이 바뀌면 숫자가 잠깐 초록·빨강으로 깜빡인다. 줄을 누르면 그 종목으로 바꾼다.
 */
export class WatchList {
  readonly root: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly heads = new Map<WatchSortKey, HTMLButtonElement>();
  private readonly sections: Record<'favorites' | 'rest', { box: HTMLDivElement; head: HTMLButtonElement; count: HTMLSpanElement; body: HTMLDivElement }>;
  private readonly status: HTMLSpanElement;
  private readonly rows = new Map<string, RowEls>();
  private symbols: SymbolInfo[] = [];
  private ticks = new Map<string, number>();
  private infos = new Map<string, SymbolInfo>();
  private stats = new Map<string, TickerStat>();
  private meta = new Map<string, CoinMeta>();
  private metaLoaded = false;
  private favorites: string[];
  private sort: WatchSort;
  private folded: Set<string>;
  private current = '';
  private timer: number | null = null;
  private loading = false;
  private open = false;

  constructor(
    private readonly storage: StorageLike,
    private readonly loadStats: () => Promise<TickerStat[]>,
    private readonly onPick: (symbol: string) => void,
    private readonly onClose: () => void = () => {},
    /** 업비트 한글 이름·유의·주의 + 코인게코 아이콘 (한 번만) */
    private readonly loadMeta: () => Promise<Map<string, CoinMeta>> = async () => new Map(),
  ) {
    this.favorites = parseFavorites(read(storage, FAV_KEY));
    this.sort = parseSort(read(storage, SORT_KEY));
    this.folded = new Set((read(storage, FOLD_KEY) ?? '').split(',').filter(Boolean));
    this.search = h('input', { type: 'search', class: 'watch-search', placeholder: '종목 찾기 · 한글·초성', 'aria-label': '종목 리스트에서 찾기', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'watch-search' });
    this.search.addEventListener('input', () => this.render());
    this.status = h('span', { class: 'watch-status', 'data-testid': 'watch-status' });
    const cols = h('div', { class: 'watch-cols watch-grid' }, h('span', { 'aria-hidden': 'true' }));
    for (const [key, label] of COLS) {
      const b = h('button', { type: 'button', class: 'watch-col', 'data-key': key, 'data-testid': `watch-sort-${key}` }, label);
      b.addEventListener('click', () => {
        this.sort = nextSort(this.sort, key);
        write(this.storage, SORT_KEY, JSON.stringify(this.sort));
        this.render();
      });
      this.heads.set(key, b);
      cols.append(b);
    }
    const section = (id: 'favorites' | 'rest', title: string) => {
      const count = h('span', { class: 'watch-count' });
      const head = h('button', { type: 'button', class: 'watch-section-head', 'aria-expanded': 'true', 'data-testid': `watch-section-${id}` }, h('span', { class: 'watch-caret', 'aria-hidden': 'true' }, '▾'), title, count);
      const body = h('div', { class: 'watch-body', role: 'list' });
      head.addEventListener('click', () => {
        if (this.folded.has(id)) this.folded.delete(id);
        else this.folded.add(id);
        write(this.storage, FOLD_KEY, [...this.folded].join(','));
        this.render();
      });
      return { box: h('div', { class: 'watch-section' }, head, body), head, count, body };
    };
    this.sections = { favorites: section('favorites', '☆ 즐겨찾기'), rest: section('rest', '전체') };
    const scroller = h('div', { class: 'watch-scroll' }, this.sections.favorites.box, this.sections.rest.box);
    scroller.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const star = t.closest('button.watch-star') as HTMLButtonElement | null;
      const row = t.closest('[data-symbol]') as HTMLElement | null;
      if (!row) return;
      const symbol = row.dataset.symbol!;
      if (star) {
        this.favorites = toggleFavorite(this.favorites, symbol);
        write(this.storage, FAV_KEY, JSON.stringify(this.favorites));
        this.render();
        return;
      }
      this.onPick(symbol);
    });
    scroller.addEventListener('keydown', (e) => {
      const row = (e.target as HTMLElement).closest('[data-symbol]') as HTMLElement | null;
      if (row && (e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('button')) {
        e.preventDefault();
        this.onPick(row.dataset.symbol!);
      }
    });
    // 좁은 화면(목록이 화면을 덮을 때)에서만 보이는 닫기
    const closeBtn = h('button', { type: 'button', class: 'watch-close', 'aria-label': '종목 리스트 닫기', 'data-testid': 'watch-close' }, '✕');
    closeBtn.addEventListener('click', () => this.onClose());
    this.root = h(
      'aside',
      { class: 'watch', 'data-testid': 'watchlist', 'aria-label': '종목 리스트', hidden: true },
      h('div', { class: 'watch-top' }, this.search, this.status, closeBtn),
      cols,
      scroller,
    );
    document.addEventListener('visibilitychange', () => this.schedule());
  }

  setSymbols(list: SymbolInfo[]): void {
    this.symbols = list;
    this.ticks = new Map(list.map((s) => [s.symbol, s.tickSize]));
    this.infos = new Map(list.map((s) => [s.symbol, s]));
    this.render();
    this.schedule();
  }

  setCurrent(symbol: string): void {
    if (this.current === symbol) return;
    this.rows.get(this.current)?.row.classList.remove('current');
    this.current = symbol;
    this.rows.get(symbol)?.row.classList.add('current');
  }

  setOpen(open: boolean): void {
    this.open = open;
    show(this.root, open);
    this.schedule();
  }

  /** 보일 때만 3초마다 받는다. 숨기면 멈춤 */
  private schedule(): void {
    const want = this.open && this.symbols.length > 0 && document.visibilityState !== 'hidden';
    if (!want) {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer !== null) return;
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      if (!this.metaLoaded) {
        this.metaLoaded = true;
        void this.loadMeta()
          .then((m) => {
            this.meta = m;
            this.render();
          })
          .catch(() => (this.metaLoaded = false));
      }
      const list = await this.loadStats();
      this.stats = new Map(list.map((s) => [s.symbol, s]));
      setText(this.status, '');
      this.render();
    } catch {
      setText(this.status, '시세 지연');
    } finally {
      this.loading = false;
    }
  }

  private render(): void {
    for (const [key, b] of this.heads) {
      const on = this.sort.key === key;
      b.classList.toggle('on', on);
      b.dataset.dir = on ? (this.sort.desc ? 'desc' : 'asc') : '';
      b.setAttribute('aria-sort', on ? (this.sort.desc ? 'descending' : 'ascending') : 'none');
    }
    const g = buildGroups(this.symbols, this.stats, this.favorites, this.search.value, this.sort, (sym) => this.metaOf(sym)?.ko);
    for (const id of ['favorites', 'rest'] as const) {
      const sec = this.sections[id];
      const list = g[id];
      const folded = this.folded.has(id);
      setText(sec.count, String(list.length));
      sec.head.setAttribute('aria-expanded', String(!folded));
      sec.box.classList.toggle('folded', folded);
      show(sec.box, id === 'rest' || list.length > 0 || !this.search.value.trim());
      if (folded) {
        sec.body.replaceChildren();
        continue;
      }
      // 이미 있는 줄은 그대로 옮겨 붙인다 (깜빡임·포커스 유지)
      sec.body.replaceChildren(...list.map((r) => this.rowFor(r)));
    }
  }

  private metaOf(symbol: string): CoinMeta | undefined {
    return this.meta.get(bybitBase(symbol).base);
  }


  /** 아이콘·한글 이름·딱지 (바뀔 때만 다시 그림) */
  private paintMeta(el: RowEls, symbol: string): void {
    const m = this.metaOf(symbol);
    const info = this.infos.get(symbol);
    const key = `${m?.img ?? ''}|${m?.ko ?? ''}|${m?.warn ? 1 : 0}${m?.caution ? 1 : 0}|${info?.delistAt ?? ''}`;
    if (el.metaKey === key) return;
    el.metaKey = key;
    if (m?.img && !el.icon.querySelector('img')) {
      const img = h('img', { src: m.img, alt: '', width: '16', height: '16', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      el.icon.replaceChildren(img);
    }
    setText(el.ko, m?.ko ?? '');
    const tags: HTMLElement[] = [];
    if (info?.delistAt) tags.push(h('span', { class: 'watch-tag delist', title: `Bybit 거래 종료 예정: ${new Date(info.delistAt).toLocaleString('ko-KR')}` }, '폐지 예정'));
    if (m?.warn) tags.push(h('span', { class: 'watch-tag warn', title: '업비트 유의 종목' }, '유의'));
    else if (m?.caution) tags.push(h('span', { class: 'watch-tag caution', title: '업비트 투자 주의 (가격 급변·거래량 급증 등)' }, '주의'));
    el.tags.replaceChildren(...tags);
  }

  private rowFor(r: WatchRow): HTMLDivElement {
    let el = this.rows.get(r.symbol);
    if (!el) {
      const base = r.symbol.replace(/USDT$/, '');
      const star = h('button', { type: 'button', class: 'watch-star', 'aria-label': `${base} 즐겨찾기` }, '★');
      const price = h('span', { class: 'watch-price num' });
      const change = h('span', { class: 'watch-change num' });
      const turnover = h('span', { class: 'watch-turnover num' });
      const icon = h('span', { class: 'watch-icon', 'aria-hidden': 'true' }, base.replace(/^\d+/, '').slice(0, 1));
      const ko = h('small', { class: 'watch-ko' });
      const tags = h('span', { class: 'watch-tags' });
      const row = h(
        'div',
        { class: 'watch-row watch-grid', role: 'listitem', tabindex: '0', 'data-symbol': r.symbol, 'data-testid': `watch-row-${r.symbol}` },
        star,
        // 전부 USDT 무기한이라 USDT는 뺀다 (이름이 잘리지 않게)
        h('span', { class: 'watch-name', title: r.symbol }, icon, h('span', { class: 'watch-label' }, h('span', { class: 'watch-line' }, h('b', {}, base), tags), ko)),
        price,
        change,
        turnover,
      );
      el = { row, star, price, change, turnover, icon, ko, tags };
      this.rows.set(r.symbol, el);
    }
    const fav = this.favorites.includes(r.symbol);
    el.star.classList.toggle('on', fav);
    el.star.setAttribute('aria-pressed', String(fav));
    el.row.classList.toggle('current', r.symbol === this.current);
    this.paintMeta(el, r.symbol);
    const s = r.stat;
    if (s) {
      setText(el.price, formatPrice(s.lastPrice, this.ticks.get(r.symbol) ?? 0.0001));
      setText(el.change, `${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}%`);
      el.change.dataset.sign = s.changePct > 0 ? 'up' : s.changePct < 0 ? 'down' : '';
      setText(el.turnover, formatTurnover(s.turnover24h));
      const dir = tickDirection(el.last, s.lastPrice);
      el.last = s.lastPrice;
      if (dir) {
        const e = el;
        e.price.dataset.flash = dir;
        if (e.flashTimer) window.clearTimeout(e.flashTimer);
        e.flashTimer = window.setTimeout(() => {
          delete e.price.dataset.flash;
        }, 700);
      }
    } else {
      setText(el.price, '—');
      setText(el.change, '');
      setText(el.turnover, '');
    }
    return el.row;
  }
}

function read(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: StorageLike, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // 저장 못 해도 이번 화면에는 적용
  }
}
