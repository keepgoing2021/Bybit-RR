import { barEnd } from '../../core/timeframe';
import type { Candle, PriceTick, SymbolInfo, TickerStat, Timeframe } from '../../core/types';

/** REST /v5/market/kline result.list (최신순) → 오름차순 캔들. serverTime 기준으로 마감된 캔들만 확정 처리 */
export function parseKlineList(list: string[][], serverTime: number, tf: Timeframe): Candle[] {
  return list
    .map((row) => {
      const time = Number(row[0]);
      return {
        time,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        // 7번째 칸 = 거래대금(USDT). 순위판이 지난 봉을 미리 채울 때 쓴다
        ...(row[6] !== undefined && Number.isFinite(Number(row[6])) ? { turnover: Number(row[6]) } : {}),
        confirmed: barEnd(tf, time) <= serverTime,
      };
    })
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);
}

/** 설계 문서 D1: USDT 무기한(LinearPerpetual), 거래 중(Trading) 종목만 */
export function parseInstruments(list: unknown[]): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (r.quoteCoin !== 'USDT' || r.contractType !== 'LinearPerpetual' || r.status !== 'Trading') continue;
    const pf = r.priceFilter as Record<string, unknown> | undefined;
    const tickSize = Number(pf?.tickSize);
    if (typeof r.symbol !== 'string' || !Number.isFinite(tickSize) || tickSize <= 0) continue;
    const info: SymbolInfo = { symbol: r.symbol, tickSize };
    const lot = r.lotSizeFilter as Record<string, unknown> | undefined;
    const pos = (v: unknown) => {
      const n = Number(v);
      return v !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const qtyStep = pos(lot?.qtyStep);
    const minQty = pos(lot?.minOrderQty);
    const minNotional = pos(lot?.minNotionalValue);
    if (qtyStep !== undefined) info.qtyStep = qtyStep;
    if (minQty !== undefined) info.minQty = minQty;
    if (minNotional !== undefined) info.minNotional = minNotional;
    out.push(info);
  }
  return out;
}

/** GET /v5/market/tickers?category=linear 의 result.list. price24hPcnt는 비율('0.0099' = +0.99%) */
export function parseTickers(list: unknown[]): TickerStat[] {
  const out: TickerStat[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const lastPrice = Number(r.lastPrice);
    const ratio = Number(r.price24hPcnt);
    const turnover24h = Number(r.turnover24h);
    if (typeof r.symbol !== 'string' || r.lastPrice === undefined || !Number.isFinite(lastPrice)) continue;
    out.push({
      symbol: r.symbol,
      lastPrice,
      changePct: Number.isFinite(ratio) && r.price24hPcnt !== '' ? Math.round(ratio * 1e6) / 1e4 : 0,
      turnover24h: Number.isFinite(turnover24h) ? turnover24h : 0,
    });
  }
  return out;
}

export type WsEvent =
  | { type: 'kline'; topic: string; candles: Candle[] }
  | { type: 'trade'; topic: string; ticks: PriceTick[] }
  | { type: 'ticker'; topic: string; lastPrice: number | null; ts: number }
  | { type: 'pong' }
  | { type: 'ack'; success: boolean; message: string }
  | { type: 'unknown' };

export function parseWsMessage(raw: string): { event: WsEvent; ts: number | null } {
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return { event: { type: 'unknown' }, ts: null };
    msg = parsed as Record<string, unknown>;
  } catch {
    return { event: { type: 'unknown' }, ts: null };
  }

  const ts = typeof msg.ts === 'number' ? msg.ts : null;

  if (msg.op === 'pong' || msg.ret_msg === 'pong') return { event: { type: 'pong' }, ts };
  if (msg.op === 'subscribe' || msg.op === 'unsubscribe') {
    return { event: { type: 'ack', success: msg.success === true, message: String(msg.ret_msg ?? '') }, ts };
  }

  const topic = typeof msg.topic === 'string' ? msg.topic : '';
  const data = msg.data;

  if (topic.startsWith('kline.') && Array.isArray(data)) {
    const candles: Candle[] = data.map((d: Record<string, unknown>) => {
      const turnover = Number(d.turnover);
      return {
        time: Number(d.start),
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
        volume: Number(d.volume),
        ...(d.turnover !== undefined && Number.isFinite(turnover) ? { turnover } : {}),
        confirmed: d.confirm === true,
      };
    });
    return { event: { type: 'kline', topic, candles }, ts };
  }

  if (topic.startsWith('publicTrade.') && Array.isArray(data)) {
    const ticks: PriceTick[] = data
      .map((d: Record<string, unknown>) => ({ price: Number(d.p), time: Number(d.T), source: 'trade' as const }))
      .filter((t) => Number.isFinite(t.price) && Number.isFinite(t.time));
    return { event: { type: 'trade', topic, ticks }, ts };
  }

  if (topic.startsWith('tickers.') && data !== null && typeof data === 'object') {
    const lp = (data as Record<string, unknown>).lastPrice;
    const lastPrice = lp === undefined ? null : Number(lp);
    return {
      event: { type: 'ticker', topic, lastPrice: Number.isFinite(lastPrice) ? lastPrice : null, ts: ts ?? 0 },
      ts,
    };
  }

  return { event: { type: 'unknown' }, ts };
}
