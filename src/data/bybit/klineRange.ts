import { MIN, type MiniCandle } from '../../core/virtualTrack';

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const PAGE = 1000;
const SYMBOL = /^[A-Z0-9]{2,30}$/;

async function getJson(fetchImpl: FetchLike, bases: readonly string[], path: string): Promise<Record<string, unknown>> {
  let last: unknown = new Error('주소 없음');
  for (const base of bases) {
    try {
      const res = await fetchImpl(`${base}${path}`);
      if (!res.ok) {
        last = new Error(`HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        last = new Error('응답 형식 오류');
        continue;
      }
      // Bybit가 오류 코드로 답했으면 요청 자체의 문제 — 다른 주소로 다시 하지 않는다
      if (body.retCode !== 0) throw new Error(`Bybit 오류 ${String(body.retCode)}`);
      return body;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Bybit 오류')) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Bybit 공개 1분 캔들을 start(분 시작)부터 now까지 — 마감된 캔들만, 오래된 것부터.
 * 한 번에 1000개라 나눠 받고, maxPages쪽까지만 받는다(더 있으면 다음 차례에 이어서). API 키 없음.
 */
export async function fetchKlineRange(fetchImpl: FetchLike, bases: readonly string[], symbol: string, start: number, now: number, maxPages: number): Promise<MiniCandle[]> {
  if (!SYMBOL.test(symbol)) throw new Error('종목 이름 오류');
  const out: MiniCandle[] = [];
  let from = Math.floor(start / MIN) * MIN;
  for (let page = 0; page < maxPages && from + MIN <= now; page++) {
    const end = Math.min(from + PAGE * MIN - 1, now);
    const body = await getJson(fetchImpl, bases, `/v5/market/kline?category=linear&symbol=${symbol}&interval=1&start=${from}&end=${end}&limit=${PAGE}`);
    const list = (body.result as { list?: unknown } | undefined)?.list;
    if (!Array.isArray(list)) throw new Error('응답 형식 오류');
    const rows: MiniCandle[] = [];
    for (const row of list as unknown[]) {
      if (!Array.isArray(row)) continue;
      const c = { time: Number(row[0]), high: Number(row[2]), low: Number(row[3]) };
      // 범위 밖·마감 전 캔들은 버린다
      if (Number.isFinite(c.time) && c.time >= from && c.time <= end && c.time + MIN <= now) rows.push(c);
    }
    rows.sort((a, b) => a.time - b.time);
    out.push(...rows);
    from += PAGE * MIN;
  }
  return out;
}

/** 지금 가격 (공개 시세). 못 받으면 null */
export async function fetchLastPrice(fetchImpl: FetchLike, bases: readonly string[], symbol: string): Promise<number | null> {
  if (!SYMBOL.test(symbol)) return null;
  try {
    const body = await getJson(fetchImpl, bases, `/v5/market/tickers?category=linear&symbol=${symbol}`);
    const row = ((body.result as { list?: unknown[] } | undefined)?.list ?? [])[0] as { lastPrice?: unknown } | undefined;
    const v = Number(row?.lastPrice);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
