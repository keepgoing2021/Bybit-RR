import type { SymbolInfo } from './types';

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
