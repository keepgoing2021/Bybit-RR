import { decimalsOf } from '../core/price';
import { formatTurnover, rankSymbols, resolveSymbol, SYMBOL_SORTS, type SymbolSort } from '../core/symbolSearch';
import type { SymbolInfo, TickerStat } from '../core/types';
import { h, setText, show } from './dom';

/** 시세 요약을 다시 받는 간격 (목록을 열 때마다 확인) */
const STATS_TTL_MS = 15_000;
const SORT_KEY = 'rrtool.v1.symbolsort';
const SORT_LABEL: Record<SymbolSort, string> = { volume: '거래대금', gainers: '상승률', losers: '하락률' };

/**
 * 종목 검색 상자 (Bybit 종목 목록처럼). 누르면 전 종목을 거래대금 순으로 보여주고,
 * 위의 탭으로 상승률·하락률 순으로 바꾼다. 각 줄에 거래대금·현재가·24시간 등락.
 * 치는 대로 거르고(정확히 맞는 종목이 맨 위), Enter는 강조된 항목, Esc·바깥 클릭은 원래 종목으로 되돌린다.
 */
export class SymbolPicker {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly note: HTMLSpanElement;
  private readonly tabs: Map<SymbolSort, HTMLButtonElement>;
  private symbols: SymbolInfo[] = [];
  private results: SymbolInfo[] = [];
  private stats = new Map<string, TickerStat>();
  private statsAt = 0;
  private loading = false;
  private statsFailed = false;
  private sort: SymbolSort = loadSort();
  private active = 0;
  private current = '';

  constructor(
    private readonly onPick: (symbol: string) => void,
    private readonly onMiss: (query: string) => void,
    private readonly loadStats: () => Promise<TickerStat[]>,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.input = h('input', {
      'data-testid': 'symbol',
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'symbol-list',
      'aria-label': '종목 검색',
    });
    this.tabs = new Map(
      SYMBOL_SORTS.map((s) => [s, h('button', { type: 'button', class: 'symbol-sort', 'data-testid': `symbol-sort-${s}` }, SORT_LABEL[s])]),
    );
    this.note = h('span', { class: 'symbol-note', 'data-testid': 'symbol-note' });
    const head = h(
      'div',
      { class: 'symbol-head' },
      h('div', { class: 'symbol-tabs', role: 'group', 'aria-label': '정렬' }, ...this.tabs.values(), this.note),
      h('div', { class: 'symbol-cols' }, h('span', {}, '종목 / 거래대금'), h('span', {}, '현재가'), h('span', {}, '24h')),
    );
    this.list = h('ul', { id: 'symbol-list', class: 'symbol-list', role: 'listbox', 'data-testid': 'symbol-list' });
    this.panel = h('div', { class: 'symbol-panel', 'data-testid': 'symbol-panel', hidden: true }, head, this.list);
    this.root = h('div', { class: 'symbol-picker' }, this.input, this.panel);

    this.input.addEventListener('focus', () => {
      this.input.placeholder = this.current;
      this.input.value = '';
      this.open('');
    });
    this.input.addEventListener('input', () => this.open(this.input.value));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => this.close(true));
    // 목록·탭을 누를 때 입력칸 포커스가 빠지지 않게 한다
    this.panel.addEventListener('mousedown', (e) => e.preventDefault());
    this.panel.addEventListener('click', (e) => {
      // 이 상자는 <label> 안에 있어서, 막지 않으면 클릭 뒤 라벨이 입력칸을 다시 포커스한다
      e.preventDefault();
      const tab = (e.target as HTMLElement).closest('button.symbol-sort');
      if (tab) {
        const s = SYMBOL_SORTS.find((k) => this.tabs.get(k) === tab);
        if (s) this.setSort(s);
        return;
      }
      const li = (e.target as HTMLElement).closest('li[data-symbol]') as HTMLLIElement | null;
      if (li) this.pick(li.dataset.symbol!);
    });
  }

  setSymbols(list: SymbolInfo[]): void {
    this.symbols = list;
    this.input.title = list.length ? `Bybit USDT 무기한 ${list.length}개 종목` : '';
  }

  setValue(symbol: string): void {
    this.current = symbol;
    if (document.activeElement !== this.input) this.input.value = symbol;
  }

  private open(query: string): void {
    this.rank(query);
    this.active = 0;
    this.render();
    this.list.scrollTop = 0;
    show(this.panel, true);
    this.input.setAttribute('aria-expanded', 'true');
    void this.refreshStats();
  }

  private rank(query: string): void {
    this.results = rankSymbols(query, this.symbols, this.stats, this.sort);
  }

  /** 시세 요약이 없거나 오래됐으면 다시 받고, 목록이 열려 있으면 그 순서로 다시 그린다 */
  private async refreshStats(): Promise<void> {
    if (this.loading || this.now() - this.statsAt < STATS_TTL_MS) return;
    this.loading = true;
    this.render();
    try {
      const list = await this.loadStats();
      this.stats = new Map(list.map((t) => [t.symbol, t]));
      this.statsAt = this.now();
      this.statsFailed = false;
    } catch {
      this.statsFailed = true;
    } finally {
      this.loading = false;
    }
    if (!this.panel.hidden) {
      const keep = this.results[this.active]?.symbol;
      this.rank(this.input.value);
      // 키보드로 고르던 항목이 있으면 그 항목을 유지
      this.active = Math.max(0, this.active > 0 && keep ? this.results.findIndex((s) => s.symbol === keep) : 0);
      this.render();
    }
  }

  private setSort(s: SymbolSort): void {
    this.sort = s;
    saveSort(s);
    this.rank(this.input.value);
    this.active = 0;
    this.render();
    this.list.scrollTop = 0;
  }

  private close(restore: boolean): void {
    show(this.panel, false);
    this.input.setAttribute('aria-expanded', 'false');
    if (restore) this.input.value = this.current;
  }

  private pick(symbol: string): void {
    this.close(false);
    this.input.value = symbol;
    this.input.blur();
    if (symbol !== this.current) this.onPick(symbol);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.results.length;
      if (!n) return;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = this.results[this.active]?.symbol ?? resolveSymbol(this.input.value, this.symbols);
      if (hit && this.input.value.trim() !== '') this.pick(hit);
      else if (this.input.value.trim() === '') this.input.blur();
      else this.onMiss(this.input.value.trim());
    } else if (e.key === 'Escape') {
      this.input.blur();
    }
  }

  private render(): void {
    for (const [s, b] of this.tabs) {
      b.classList.toggle('active', s === this.sort);
      b.setAttribute('aria-pressed', String(s === this.sort));
    }
    setText(
      this.note,
      this.stats.size ? '' : this.loading ? '시세 불러오는 중…' : this.statsFailed ? '시세를 못 받아 이름순' : '',
    );
    const items: HTMLLIElement[] = this.results.map((s, i) => this.row(s, i === this.active));
    if (!items.length) {
      items.push(h('li', { class: 'symbol-more' }, this.symbols.length ? '맞는 종목이 없습니다' : '종목 목록을 불러오지 못했습니다'));
    }
    this.list.replaceChildren(...items);
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  private row(s: SymbolInfo, selected: boolean): HTMLLIElement {
    const t = this.stats.get(s.symbol);
    const d = decimalsOf(s.tickSize);
    const price = t ? t.lastPrice.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '';
    const chg = t ? `${t.changePct > 0 ? '+' : t.changePct < 0 ? '−' : ''}${Math.abs(t.changePct).toFixed(2)}%` : '';
    return h(
      'li',
      { role: 'option', 'data-symbol': s.symbol, 'data-testid': 'symbol-option', 'aria-selected': String(selected) },
      h('span', { class: 'sym' }, h('b', { 'data-testid': 'symbol-name' }, s.symbol), h('small', { 'data-testid': 'symbol-turnover' }, t ? formatTurnover(t.turnover24h) : '')),
      h('span', { class: 'px num' }, price),
      h('span', { class: `chg num ${t ? (t.changePct >= 0 ? 'up' : 'down') : ''}`, 'data-testid': 'symbol-change' }, chg),
    );
  }
}

function loadSort(): SymbolSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return SYMBOL_SORTS.includes(v as SymbolSort) ? (v as SymbolSort) : 'volume';
  } catch {
    return 'volume';
  }
}

function saveSort(s: SymbolSort): void {
  try {
    localStorage.setItem(SORT_KEY, s);
  } catch {
    // 저장 못 해도 이번 화면에는 적용
  }
}
