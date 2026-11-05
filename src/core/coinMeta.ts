/**
 * 종목 리스트에 붙이는 바깥 정보 (2026-11-05, 웨돔에서 확인된 출처만 따라 붙임):
 * - 업비트: 한글 이름, 유의·주의 종목, 원화 가격(김프 계산)
 * - 코인게코: 코인 아이콘
 * Bybit 종목 이름과 업비트·코인게코 이름은 그대로 같지 않다 — 1000PEPE(1000개 묶음), SHIB1000 등
 */
export interface CoinMeta {
  /** 업비트 한글 이름 */
  ko?: string;
  /** 업비트 유의 종목(투자 유의) */
  warn?: boolean;
  /** 업비트 투자 주의(가격 급변·거래량 급증 등) 중 하나라도 */
  caution?: boolean;
  /** 아이콘 주소 (코인게코) */
  img?: string;
}

/** Bybit 무기한 이름 → 코인 이름과 묶음 수. 1000PEPEUSDT → PEPE ×1000, SHIB1000USDT → SHIB ×1000 */
export function bybitBase(symbol: string): { base: string; mult: number } {
  const s = symbol.replace(/USDT$/, '');
  let m = /^(10{2,})([A-Z].*)$/.exec(s);
  if (m) return { base: m[2], mult: Number(m[1]) };
  m = /^([A-Z][A-Z0-9]*?)(10{2,})$/.exec(s);
  if (m) return { base: m[1], mult: Number(m[2]) };
  return { base: s, mult: 1 };
}

/** 김프(%): 업비트 원화 가격 ÷ (Bybit 달러 가격 × 업비트 USDT 원화 가격) − 1. 계산 못 하면 null */
export function kimchiPremium(upbitKrw: number | undefined, bybitUsdt: number, mult: number, usdtKrw: number | undefined): number | null {
  if (!upbitKrw || !usdtKrw || !(bybitUsdt > 0) || !(mult > 0)) return null;
  return (upbitKrw / ((bybitUsdt / mult) * usdtKrw) - 1) * 100;
}

/** 업비트 /v1/market/all?isDetails=true → 코인 이름별 한글 이름·유의·주의 (원화 마켓만) */
export function parseUpbitMarkets(list: unknown): Map<string, CoinMeta> {
  const out = new Map<string, CoinMeta>();
  if (!Array.isArray(list)) return out;
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.market !== 'string' || !r.market.startsWith('KRW-')) continue;
    const ev = (r.market_event ?? {}) as { warning?: unknown; caution?: Record<string, unknown> };
    out.set(r.market.slice(4), {
      ko: typeof r.korean_name === 'string' ? r.korean_name.slice(0, 40) : undefined,
      warn: ev.warning === true,
      caution: !!ev.caution && Object.values(ev.caution).some((v) => v === true),
    });
  }
  return out;
}

/** 업비트 /v1/ticker/all?quote_currencies=KRW → 코인 이름별 원화 가격 */
export function parseUpbitPrices(list: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(list)) return out;
  for (const x of list) {
    const r = x as Record<string, unknown>;
    if (typeof r?.market !== 'string' || !r.market.startsWith('KRW-')) continue;
    const p = Number(r.trade_price);
    if (Number.isFinite(p) && p > 0) out.set(r.market.slice(4), p);
  }
  return out;
}

/** 아이콘 주소는 코인게코 이미지 서버만 받는다 (화면 보안 정책과 같게) */
const CG_IMG = /^https:\/\/coin-images\.coingecko\.com\/coins\/images\/\d+\/(?:large|small|thumb)\/[A-Za-z0-9._%-]+(?:\?\d+)?$/;

/** 코인게코 /coins/markets → 코인 이름별 아이콘 (같은 이름이 여럿이면 시총 순위 높은 쪽) */
export function parseCoinGecko(list: unknown): Map<string, string> {
  const out = new Map<string, { img: string; rank: number }>();
  if (!Array.isArray(list)) return new Map();
  for (const x of list) {
    const r = x as Record<string, unknown>;
    if (typeof r?.symbol !== 'string' || typeof r.image !== 'string' || !CG_IMG.test(r.image)) continue;
    const sym = r.symbol.toUpperCase();
    const rank = typeof r.market_cap_rank === 'number' ? r.market_cap_rank : 1e9;
    const prev = out.get(sym);
    if (!prev || rank < prev.rank) out.set(sym, { img: r.image.replace('/large/', '/small/'), rank });
  }
  return new Map([...out].map(([k, v]) => [k, v.img]));
}
