import type { SymbolInfo } from './types';

/**
 * 트레이딩뷰 와치리스트 가져오기 (2026-11-06). 공유 목록의 symbols 배열은
 * ['###묶음 이름', 'NYSE:KO', 'NASDAQ:TSLA', '###다음 묶음', ...] 모양이다.
 */
export interface MyGroup {
  name: string;
  /** 트레이딩뷰 이름 그대로 (예: 'NASDAQ:TSLA') */
  items: string[];
}

export const MAX_GROUPS = 40;
export const MAX_ITEMS = 300;
const TV_SYMBOL = /^[A-Za-z0-9_.!*&+\-():/^ ]{1,120}$/;

/** symbols 배열 → 묶음들. 첫 ### 앞의 종목은 「목록」 묶음으로 */
export function parseTvSymbols(list: unknown): MyGroup[] {
  if (!Array.isArray(list)) return [];
  const out: MyGroup[] = [];
  let cur: MyGroup | null = null;
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (v.startsWith('###')) {
      const name = v.slice(3).trim().slice(0, 40) || '이름 없음';
      cur = { name, items: [] };
      out.push(cur);
      continue;
    }
    if (!v || !TV_SYMBOL.test(v)) continue;
    if (!cur) {
      cur = { name: '목록', items: [] };
      out.push(cur);
    }
    if (!cur.items.includes(v)) cur.items.push(v);
  }
  return out.filter((g) => g.items.length).slice(0, MAX_GROUPS);
}

/** 붙여 넣은 글: 트레이딩뷰 내보내기 txt(쉼표·줄바꿈) 또는 symbols 배열 JSON */
export function parseTvText(text: string): MyGroup[] {
  const t = text.trim();
  if (t.startsWith('[')) {
    try {
      return parseTvSymbols(JSON.parse(t));
    } catch {
      // 아래 쉼표 방식으로
    }
  }
  return parseTvSymbols(t.split(/[,\n\r]+/));
}

/** 공유 링크에서 목록 번호. 아니면 null */
export function tvWatchlistId(url: string): string | null {
  const m = /tradingview\.com\/watchlists\/(\d{1,12})\/?/.exec(url.trim());
  return m ? m[1] : null;
}

/** 트레이딩뷰 이름 → Bybit 무기한 (주식·ETF·원자재·환율만 이름이 같아도 다른 코인과 헷갈리지 않게 kind로 확인) */
const ALIAS: Record<string, string> = {
  'TVC:GOLD': 'XAUUSDT',
  'OANDA:XAUUSD': 'XAUUSDT',
  'TVC:SILVER': 'XAGUSDT',
  'OANDA:XAGUSD': 'XAGUSDT',
  'TVC:USOIL': 'CLUSDT',
  'TVC:UKOIL': 'BZUSDT',
};

export function mapTvToBybit(tv: string, symbols: SymbolInfo[]): string | null {
  if (ALIAS[tv]) return symbols.some((s) => s.symbol === ALIAS[tv]) ? ALIAS[tv] : null;
  const [ex, ticker] = tv.includes(':') ? tv.split(':', 2) : ['', tv];
  const t = (ticker ?? '').toUpperCase();
  const find = (sym: string, kinds: SymbolInfo['kind'][]) => symbols.find((s) => s.symbol === sym && kinds.includes(s.kind));
  if (['NYSE', 'NASDAQ', 'AMEX', 'BATS', 'NYSEARCA'].includes(ex)) {
    // 이름이 코인과 겹치면 Bybit는 'AMDSTOCK'처럼 붙인다
    return (find(`${t}USDT`, ['stock', 'etf']) ?? find(`${t}STOCKUSDT`, ['stock', 'etf']))?.symbol ?? null;
  }
  if (ex.startsWith('FX') || ex === 'OANDA' || ex === 'FOREXCOM') return find(`${t}USDT`, ['forex', 'commodity'])?.symbol ?? null;
  // 거래소 없이 코인 이름 (BYBIT:BTCUSDT.P, BINANCE:BTCUSDT 등)
  if (['BYBIT', 'BINANCE', 'OKX', 'BITGET', 'COINBASE', 'UPBIT'].includes(ex) || !ex) {
    const base = t.replace(/\.P$/, '').replace(/(USDT|USD|USDC|KRW)$/, '');
    return symbols.find((s) => s.symbol === `${base}USDT` && !s.kind)?.symbol ?? null;
  }
  return null;
}

/** 화면에 보일 짧은 이름: 'NASDAQ:TSLA' → 'TSLA' */
export function tvTicker(tv: string): string {
  const t = tv.includes(':') ? tv.split(':').slice(1).join(':') : tv;
  return t.length > 18 ? `${t.slice(0, 17)}…` : t;
}

export function parseMyGroups(raw: string | null): MyGroup[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((g): g is MyGroup => !!g && typeof g.name === 'string' && Array.isArray(g.items))
      .map((g) => ({ name: g.name.slice(0, 40), items: g.items.filter((x) => typeof x === 'string' && TV_SYMBOL.test(x)).slice(0, MAX_ITEMS) }))
      .slice(0, MAX_GROUPS);
  } catch {
    return [];
  }
}

/** 가져온 묶음을 합친다: 같은 이름은 새 것으로 바꾸고, 새 이름은 뒤에 붙인다 */
export function mergeGroups(cur: MyGroup[], incoming: MyGroup[]): MyGroup[] {
  const names = new Set(incoming.map((g) => g.name));
  return [...cur.filter((g) => !names.has(g.name)), ...incoming].slice(0, MAX_GROUPS);
}
