import { formatPrice } from '../core/price';
import { formatTurnover } from '../core/symbolSearch';
import type { SymbolInfo, TickerStat } from '../core/types';
import { bybitBase, type CoinMeta } from '../core/coinMeta';
import { mapTvToBybit, mergeGroups, parseMyGroups, parseTvSymbols, parseTvText, tvTicker, tvWatchlistId, type MyGroup } from '../core/tvImport';
import { matchKorean, sortRows } from '../core/watchlist';
import { buildGroups, nextSort, parseFavorites, parseSort, tickDirection, toggleFavorite, type WatchRow, type WatchSort, type WatchSortKey } from '../core/watchlist';
import type { StorageLike } from '../core/persistence';
import { h, setText, show } from './dom';

/** 시세를 다시 받는 간격. 목록이 보이고 탭이 앞에 있을 때만 받는다 (Bybit 전 종목 시세 한 번 = 요청 하나) */
const REFRESH_MS = 3_000;
const FAV_KEY = 'rrtool.v1.favorites';
const SORT_KEY = 'rrtool.v1.watchsort';
const FOLD_KEY = 'rrtool.v1.watchfold';
/** 내 묶음 (트레이딩뷰에서 가져온 묶음·종목, 2026-11-06) */
const GROUPS_KEY = 'rrtool.v1.mygroups';

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
  /** 내 묶음 칸 (이름별) */
  private readonly groupSecs = new Map<string, { box: HTMLDivElement; head: HTMLButtonElement; count: HTMLSpanElement; body: HTMLDivElement }>();
  private readonly groupsBox: HTMLDivElement;
  private readonly importBox: HTMLDivElement;
  private readonly importInput: HTMLInputElement;
  private readonly importMsg: HTMLSpanElement;
  private readonly noData = new Map<string, HTMLDivElement>();
  private groups: MyGroup[];
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
    this.groups = parseMyGroups(read(storage, GROUPS_KEY));
    this.groupsBox = h('div', { class: 'watch-groups', 'data-testid': 'watch-groups' });
    // 트레이딩뷰 가져오기: 공유 링크(공유 목록 켜기 → 링크 복사) 또는 목록 글 붙여 넣기
    this.importInput = h('input', { class: 'watch-import-input', placeholder: '트레이딩뷰 공유 링크 붙여 넣기', 'aria-label': '트레이딩뷰 공유 링크', 'data-testid': 'watch-import-input', autocomplete: 'off' });
    this.importMsg = h('span', { class: 'watch-import-msg', role: 'status', 'data-testid': 'watch-import-msg' });
    const importGo = h('button', { type: 'button', class: 'watch-import-go', 'data-testid': 'watch-import-go' }, '가져오기');
    importGo.addEventListener('click', () => void this.doImport());
    this.importInput.addEventListener('keydown', (e) => e.key === 'Enter' && void this.doImport());
    this.importBox = h(
      'div',
      { class: 'watch-import', hidden: true },
      h('div', { class: 'watch-import-row' }, this.importInput, importGo),
      h('small', { class: 'muted' }, '트레이딩뷰 와치리스트 메뉴 → 「공유 목록」 켜기 → 「링크 복사」. 묶음 이름·종목이 그대로 들어와요'),
      this.importMsg,
    );
    const importToggle = h('button', { type: 'button', class: 'watch-import-toggle', 'data-testid': 'watch-import-toggle' }, '＋ 트레이딩뷰 목록 가져오기');
    importToggle.addEventListener('click', () => {
      this.importBox.hidden = !this.importBox.hidden;
      if (!this.importBox.hidden) this.importInput.focus();
    });
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
    const scroller = h('div', { class: 'watch-scroll' }, this.sections.favorites.box, this.groupsBox, this.sections.rest.box);
    scroller.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const star = t.closest('button.watch-star') as HTMLButtonElement | null;
      const row = t.closest('[data-symbol]') as HTMLElement | null;
      const del = t.closest('button.watch-group-del') as HTMLButtonElement | null;
      if (del) {
        this.deleteGroup(del);
        return;
      }
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
      h('div', { class: 'watch-import-wrap' }, importToggle, this.importBox),
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
    this.current = symbol;
    for (const [key, el] of this.rows) el.row.classList.toggle('current', key.endsWith(`|${symbol}`));
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
      sec.body.replaceChildren(...list.map((r) => this.rowFor(r, id)));
    }
    this.renderGroups();
  }

  /** 내 묶음: Bybit에 있는 종목은 시세와 함께(정렬은 위 칸 기준), 없는 종목은 뒤에 「시세 없음」 */
  private renderGroups(): void {
    const q = this.search.value.trim();
    const qU = q.toUpperCase();
    const korean = /[ㄱ-ㅎ가-힣]/.test(q);
    const sections: HTMLElement[] = [];
    for (const g of this.groups) {
      const key = `g:${g.name}`;
      let sec = this.groupSecs.get(g.name);
      if (!sec) {
        const count = h('span', { class: 'watch-count' });
        const del = h('button', { type: 'button', class: 'watch-group-del', 'data-group': g.name, title: '이 묶음 지우기', 'aria-label': `${g.name} 묶음 지우기` }, '✕');
        const head = h('button', { type: 'button', class: 'watch-section-head', 'aria-expanded': 'true', 'data-testid': 'watch-group-head' }, h('span', { class: 'watch-caret', 'aria-hidden': 'true' }, '▾'), g.name, count);
        head.addEventListener('click', () => {
          if (this.folded.has(key)) this.folded.delete(key);
          else this.folded.add(key);
          write(this.storage, FOLD_KEY, [...this.folded].join(','));
          this.render();
        });
        const body = h('div', { class: 'watch-body', role: 'list' });
        sec = { box: h('div', { class: 'watch-section watch-group' }, h('div', { class: 'watch-group-head-row' }, head, del), body), head, count, body };
        this.groupSecs.set(g.name, sec);
      }
      const mapped: WatchRow[] = [];
      const missing: string[] = [];
      for (const tv of g.items) {
        const sym = mapTvToBybit(tv, this.symbols);
        const label = tvTicker(tv);
        const hit = !q || (korean ? !!sym && matchKorean(this.metaOf(sym)?.ko, q) : label.toUpperCase().includes(qU) || (sym ?? '').includes(qU));
        if (!hit) continue;
        if (sym) {
          if (!mapped.some((r) => r.symbol === sym)) mapped.push({ symbol: sym, stat: this.stats.get(sym) ?? null });
        } else missing.push(tv);
      }
      const total = mapped.length + missing.length;
      if (q && !total) continue;
      const folded = this.folded.has(key);
      setText(sec.count, `${total}`);
      sec.head.setAttribute('aria-expanded', String(!folded));
      sec.box.classList.toggle('folded', folded);
      sec.body.replaceChildren(...(folded ? [] : [...sortRows(mapped, this.sort).map((r) => this.rowFor(r, key)), ...missing.map((tv) => this.noDataRow(tv))]));
      sections.push(sec.box);
    }
    this.groupsBox.replaceChildren(...sections);
  }

  /** Bybit에 없는 종목: 이름만 (시세는 다음 단계에서 주식 시세 연결) */
  private noDataRow(tv: string): HTMLDivElement {
    let row = this.noData.get(tv);
    if (!row) {
      const ex = tv.includes(':') ? tv.split(':')[0] : '';
      row = h(
        'div',
        { class: 'watch-row watch-grid watch-nodata', role: 'listitem', title: `${tv} — Bybit에 없는 종목이라 아직 시세가 없어요` },
        h('span', { 'aria-hidden': 'true' }),
        h('span', { class: 'watch-name' }, h('span', { class: 'watch-icon', 'aria-hidden': 'true' }, tvTicker(tv).replace(/^[^A-Za-z0-9]+/, '').slice(0, 1)), h('span', { class: 'watch-label' }, h('b', {}, tvTicker(tv)), h('small', { class: 'watch-ko' }, ex))),
        h('span', { class: 'watch-price muted' }, '시세 없음'),
        h('span', {}),
        h('span', {}),
      );
      this.noData.set(tv, row);
    }
    return row;
  }

  private async doImport(): Promise<void> {
    const v = this.importInput.value.trim();
    if (!v) return;
    setText(this.importMsg, '가져오는 중…');
    let groups: MyGroup[] = [];
    try {
      const id = tvWatchlistId(v);
      if (id) {
        const r = await fetch(`/tv-watchlist/${id}`, { headers: { Accept: 'application/json' } });
        const body = (await r.json()) as { symbols?: unknown; error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        groups = parseTvSymbols(body.symbols);
      } else groups = parseTvText(v);
    } catch (e) {
      setText(this.importMsg, `가져오지 못했어요: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
      return;
    }
    if (!groups.length) {
      setText(this.importMsg, '종목을 찾지 못했어요. 공유 링크(…/watchlists/숫자/)인지 확인해 주세요');
      return;
    }
    this.groups = mergeGroups(this.groups, groups);
    write(this.storage, GROUPS_KEY, JSON.stringify(this.groups));
    const items = groups.flatMap((g) => g.items);
    const linked = items.filter((tv) => mapTvToBybit(tv, this.symbols)).length;
    setText(this.importMsg, `✓ 묶음 ${groups.length}개 · 종목 ${items.length}개 가져옴 (Bybit 시세 연결 ${linked}개)`);
    this.importInput.value = '';
    this.render();
  }

  /** ✕ 두 번 누르면 지우기 (한 번 = 「정말?」) */
  private deleteGroup(btn: HTMLButtonElement): void {
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      setText(btn, '정말?');
      window.setTimeout(() => {
        delete btn.dataset.armed;
        setText(btn, '✕');
      }, 3000);
      return;
    }
    const name = btn.dataset.group!;
    this.groups = this.groups.filter((g) => g.name !== name);
    this.groupSecs.delete(name);
    write(this.storage, GROUPS_KEY, JSON.stringify(this.groups));
    this.render();
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

  private rowFor(r: WatchRow, section: string): HTMLDivElement {
    const rowKey = `${section}|${r.symbol}`;
    let el = this.rows.get(rowKey);
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
        // 같은 종목이 내 묶음에도 있으면 줄이 여럿이라 시험용 이름은 즐겨찾기·전체 칸에만
        { class: 'watch-row watch-grid', role: 'listitem', tabindex: '0', 'data-symbol': r.symbol, 'data-testid': section.startsWith('g:') ? `watch-grow-${r.symbol}` : `watch-row-${r.symbol}` },
        star,
        // 전부 USDT 무기한이라 USDT는 뺀다 (이름이 잘리지 않게)
        h('span', { class: 'watch-name', title: r.symbol }, icon, h('span', { class: 'watch-label' }, h('span', { class: 'watch-line' }, h('b', {}, base), tags), ko)),
        price,
        change,
        turnover,
      );
      el = { row, star, price, change, turnover, icon, ko, tags };
      this.rows.set(rowKey, el);
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
