import { searchSymbols } from './symbolSearch';
import type { SymbolInfo, TickerStat } from './types';

/**
 * 종목 리스트(와치리스트, 2026-11-05): 즐겨찾기 묶음 + 나머지 전체.
 * 칸 이름을 누르면 그 칸으로 정렬(한 번 더 누르면 반대). 검색어가 있으면 두 묶음 모두 거른다.
 */
export type WatchSortKey = 'symbol' | 'price' | 'change' | 'premium' | 'turnover';
export interface WatchSort {
  key: WatchSortKey;
  /** 내림차순(큰 값 먼저) */
  desc: boolean;
}
export const DEFAULT_SORT: WatchSort = { key: 'turnover', desc: true };
export const DEFAULT_FAVORITES = ['BTCUSDT', 'ETHUSDT'];

export interface WatchRow {
  symbol: string;
  stat: TickerStat | null;
  /** 김프 % (업비트에 없는 종목은 null) */
  premium?: number | null;
}

/** 시세가 없는 종목은 정렬 방향과 상관없이 맨 뒤 */
export function sortRows(rows: WatchRow[], sort: WatchSort): WatchRow[] {
  const val = (r: WatchRow): number | string | null => {
    if (sort.key === 'symbol') return r.symbol;
    if (sort.key === 'premium') return r.premium ?? null;
    if (!r.stat) return null;
    return sort.key === 'price' ? r.stat.lastPrice : sort.key === 'change' ? r.stat.changePct : r.stat.turnover24h;
  };
  return [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null || vb === null) return va === null && vb === null ? a.symbol.localeCompare(b.symbol) : va === null ? 1 : -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return (sort.desc ? -cmp : cmp) || a.symbol.localeCompare(b.symbol);
  });
}

/** 같은 칸을 다시 누르면 방향만 바꾼다. 새 칸은 이름순만 오름차순, 숫자는 큰 값 먼저 */
export function nextSort(cur: WatchSort, key: WatchSortKey): WatchSort {
  if (cur.key === key) return { key, desc: !cur.desc };
  return { key, desc: key !== 'symbol' };
}

export interface WatchGroups {
  favorites: WatchRow[];
  rest: WatchRow[];
}

/** 즐겨찾기(목록에 있는 종목만)와 나머지로 나누고, 검색어로 거른 뒤 정렬 */
export function buildGroups(
  symbols: SymbolInfo[],
  stats: Map<string, TickerStat>,
  favorites: string[],
  query: string,
  sort: WatchSort,
  /** 종목 → 한글 이름 (한글·초성으로도 찾게) */
  koName: (symbol: string) => string | undefined = () => undefined,
  premium: (symbol: string) => number | null = () => null,
): WatchGroups {
  const fav = new Set(favorites);
  const q = query.trim();
  let matched = symbols;
  if (q && /[ㄱ-ㅎ가-힣]/.test(q)) matched = symbols.filter((s) => matchKorean(koName(s.symbol), q));
  else if (q) matched = searchSymbols(q, symbols);
  const rows = matched.map((s) => ({ symbol: s.symbol, stat: stats.get(s.symbol) ?? null, premium: premium(s.symbol) }));
  return {
    favorites: sortRows(rows.filter((r) => fav.has(r.symbol)), sort),
    rest: sortRows(rows.filter((r) => !fav.has(r.symbol)), sort),
  };
}

/** 가격이 바뀐 방향 (깜빡임 색) */
export function tickDirection(prev: number | undefined, next: number): 'up' | 'down' | null {
  if (prev === undefined || prev === next || !Number.isFinite(prev)) return null;
  return next > prev ? 'up' : 'down';
}

/** 저장된 즐겨찾기 읽기: 깨졌거나 없으면 기본(BTC·ETH) */
export function parseFavorites(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_FAVORITES];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[A-Z0-9]{2,30}$/.test(x)))];
  } catch {
    // 아래 기본값
  }
  return [...DEFAULT_FAVORITES];
}

export function toggleFavorite(list: string[], symbol: string): string[] {
  return list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol];
}

export function parseSort(raw: string | null): WatchSort {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && ['symbol', 'price', 'change', 'turnover'].includes(v.key) && typeof v.desc === 'boolean') return { key: v.key, desc: v.desc };
  } catch {
    // 기본값
  }
  return { ...DEFAULT_SORT };
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한글 이름의 초성만: '비트코인' → 'ㅂㅌㅋㅇ' (한글이 아닌 글자는 그대로) */
export function chosung(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}

/** 한글 검색: 이름에 그대로 들어 있거나, 초성만 친 경우 초성이 이어서 맞으면 */
export function matchKorean(name: string | undefined, query: string): boolean {
  if (!name) return false;
  const q = query.replace(/\s+/g, '');
  const n = name.replace(/\s+/g, '');
  if (n.includes(q)) return true;
  return /^[ㄱ-ㅎ]+$/.test(q) && chosung(n).includes(q);
}
