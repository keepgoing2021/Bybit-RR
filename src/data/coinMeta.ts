import { parseCoinGecko, parseUpbitMarkets, parseUpbitPrices, type CoinMeta } from '../core/coinMeta';
import type { StorageLike } from '../core/persistence';

/**
 * 업비트·코인게코 공개 API (둘 다 브라우저에서 바로 부를 수 있음: CORS *, 키 없음).
 * 이름·아이콘처럼 잘 안 바뀌는 건 내 브라우저에 담아 두고(업비트 6시간, 코인게코 하루), 원화 가격만 매번 받는다.
 * 코인게코 무료 API는 1분에 몇 번만 허락하므로 열 때마다 부르지 않는다.
 */
const UPBIT = 'https://api.upbit.com/v1';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const UPBIT_META_KEY = 'rrtool.v1.upbitmeta';
const ICON_KEY = 'rrtool.v1.coinicons';
const UPBIT_META_TTL = 6 * 3600_000;
const ICON_TTL = 24 * 3600_000;

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function cached<T>(storage: StorageLike, key: string, ttl: number, now: number): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; data: T };
    return typeof v?.at === 'number' && now - v.at < ttl ? v.data : null;
  } catch {
    return null;
  }
}

function store(storage: StorageLike, key: string, data: unknown, now: number): void {
  try {
    storage.setItem(key, JSON.stringify({ at: now, data }));
  } catch {
    // 못 담아도 이번 화면에는 쓴다
  }
}

/** 코인 이름(BTC) → 한글 이름·유의·주의·아이콘. 하나가 실패해도 나머지로 채운다 */
export async function loadCoinMeta(storage: StorageLike, now = Date.now()): Promise<Map<string, CoinMeta>> {
  let upbit = cached<[string, CoinMeta][]>(storage, UPBIT_META_KEY, UPBIT_META_TTL, now);
  let icons = cached<[string, string][]>(storage, ICON_KEY, ICON_TTL, now);
  await Promise.all([
    upbit
      ? null
      : json(`${UPBIT}/market/all?isDetails=true`)
          .then((d) => {
            upbit = [...parseUpbitMarkets(d)];
            store(storage, UPBIT_META_KEY, upbit, now);
          })
          .catch(() => null),
    icons
      ? null
      : Promise.all([1, 2].map((p) => json(`${COINGECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}`)))
          .then((pages) => {
            icons = [...parseCoinGecko(pages.flat())];
            store(storage, ICON_KEY, icons, now);
          })
          .catch(() => null),
  ]);
  const out = new Map<string, CoinMeta>(upbit ?? []);
  for (const [k, img] of icons ?? []) out.set(k, { ...out.get(k), img });
  return out;
}

/** 업비트 원화 가격 전부 (김프 계산용) */
export async function loadUpbitPrices(): Promise<Map<string, number>> {
  return parseUpbitPrices(await json(`${UPBIT}/ticker/all?quote_currencies=KRW`));
}
