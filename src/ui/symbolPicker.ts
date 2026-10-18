import { resolveSymbol, searchSymbols } from '../core/symbolSearch';
import type { SymbolInfo } from '../core/types';
import { h, show } from './dom';

const MAX_SHOWN = 80;

/**
 * 종목 검색 상자. 누르면 칸을 비우고 전체 목록을 보여주며, 치는 대로 거른다.
 * Enter는 강조된 항목(없으면 가장 잘 맞는 종목)을 고른다. Esc·바깥 클릭은 원래 종목으로 되돌린다.
 */
export class SymbolPicker {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private symbols: SymbolInfo[] = [];
  private results: SymbolInfo[] = [];
  private active = 0;
  private current = '';

  constructor(
    private readonly onPick: (symbol: string) => void,
    private readonly onMiss: (query: string) => void,
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
    this.list = h('ul', { id: 'symbol-list', class: 'symbol-list', role: 'listbox', 'data-testid': 'symbol-list', hidden: true });
    this.root = h('div', { class: 'symbol-picker' }, this.input, this.list);

    this.input.addEventListener('focus', () => {
      this.input.placeholder = this.current;
      this.input.value = '';
      this.open('');
    });
    this.input.addEventListener('input', () => this.open(this.input.value));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => this.close(true));
    // 항목을 누를 때 입력칸 포커스가 빠지지 않게 한다
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      // 이 상자는 <label> 안에 있어서, 막지 않으면 클릭 뒤 라벨이 입력칸을 다시 포커스한다
      e.preventDefault();
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
    this.results = searchSymbols(query, this.symbols);
    this.active = 0;
    this.render();
    show(this.list, true);
    this.input.setAttribute('aria-expanded', 'true');
  }

  private close(restore: boolean): void {
    show(this.list, false);
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
      if (!this.results.length) return;
      const n = Math.min(this.results.length, MAX_SHOWN);
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
    const shown = this.results.slice(0, MAX_SHOWN);
    const items: HTMLLIElement[] = shown.map((s, i) => {
      const li = h('li', { role: 'option', 'data-symbol': s.symbol, 'data-testid': 'symbol-option', 'aria-selected': String(i === this.active) }, s.symbol);
      return li;
    });
    if (!shown.length) {
      items.push(h('li', { class: 'symbol-more' }, this.symbols.length ? '맞는 종목이 없습니다' : '종목 목록을 불러오지 못했습니다'));
    } else if (this.results.length > shown.length) {
      items.push(h('li', { class: 'symbol-more' }, `외 ${this.results.length - shown.length}개, 더 입력해 좁히세요`));
    }
    this.list.replaceChildren(...items);
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
}
