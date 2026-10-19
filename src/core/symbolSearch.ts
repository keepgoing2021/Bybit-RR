import type { SymbolInfo, TickerStat } from './types';

/** 'BYBIT:SOLUSDT.P', 'sol/usdt', 'Sol-Usdt' → 'SOLUSDT' */
export function normalizeQuery(q: string): string {
  return q
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_]+:/, '') // 거래소 접두사 (TradingView 표기)
    .replace(/\.P$/, '') // 무기한 접미사 (TradingView 표기)
    .replace(/[\s/\-_]/g, '');
}

const base = (normalized: string) => normalized.replace(/USDT$/, '');

/** 0: 정확히 같음, 1: 코인 이름이 같음, 2: 앞부분이 같음, 3: 포함, null: 무관 */
function score(symbol: string, q: string): number | null {
  const s = normalizeQuery(symbol);
  if (s === q) return 0;
  if (base(s) === q) return 1;
  if (s.startsWith(q)) return 2;
  if (s.includes(q)) return 3;
  return null;
}

/** 검색어에 맞는 종목을 정확도 순으로. 빈 검색어면 전체를 원래 순서로 */
export function searchSymbols(query: string, list: SymbolInfo[]): SymbolInfo[] {
  const q = normalizeQuery(query);
  if (!q) return [...list];
  return list
    .map((s, i) => ({ s, i, sc: score(s.symbol, q) }))
    .filter((x): x is { s: SymbolInfo; i: number; sc: number } => x.sc !== null)
    .sort((a, b) => a.sc - b.sc || a.i - b.i)
    .map((x) => x.s);
}

/** Enter를 눌렀을 때 갈 종목: 가장 잘 맞는 하나 (없으면 null) */
export function resolveSymbol(query: string, list: SymbolInfo[]): string | null {
  if (!normalizeQuery(query)) return null;
  return searchSymbols(query, list)[0]?.symbol ?? null;
}

/** 종목 목록 정렬: 거래대금 많은 순 / 상승률 높은 순 / 하락률 큰 순 */
export type SymbolSort = 'volume' | 'gainers' | 'losers';
export const SYMBOL_SORTS: SymbolSort[] = ['volume', 'gainers', 'losers'];

/**
 * 목록에 보여줄 순서. 검색어가 있으면 맞는 것만, 그중 정확히 같거나 코인 이름이 같은 것을 맨 위에.
 * 나머지는 고른 정렬. 시세가 없는 종목은 맨 뒤(가나다순).
 */
export function rankSymbols(query: string, list: SymbolInfo[], stats: ReadonlyMap<string, TickerStat>, sort: SymbolSort): SymbolInfo[] {
  const q = normalizeQuery(query);
  const key = (s: SymbolInfo): number | null => {
    const t = stats.get(s.symbol);
    if (!t) return null;
    return sort === 'volume' ? -t.turnover24h : sort === 'gainers' ? -t.changePct : t.changePct;
  };
  return list
    .map((s) => ({ s, sc: q ? score(s.symbol, q) : 9, k: key(s) }))
    .filter((x) => x.sc !== null)
    .sort((a, b) => {
      const exactA = (a.sc as number) <= 1 ? 0 : 1;
      const exactB = (b.sc as number) <= 1 ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      if (a.k === null || b.k === null) return a.k === null && b.k === null ? a.s.symbol.localeCompare(b.s.symbol) : a.k === null ? 1 : -1;
      return a.k - b.k || a.s.symbol.localeCompare(b.s.symbol);
    })
    .map((x) => x.s);
}

/** 거래대금 짧게: 8.27B, 759.91M, 12.30K, 950 */
export function formatTurnover(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}
