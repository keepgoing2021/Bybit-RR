import { tfMs } from '../../core/timeframe';
import type { Candle, PriceTick, SymbolInfo, Timeframe } from '../../core/types';

/** REST /v5/market/kline result.list (최신순) → 오름차순 캔들. serverTime 기준으로 마감된 캔들만 확정 처리 */
export function parseKlineList(list: string[][], serverTime: number, tf: Timeframe): Candle[] {
  const dur = tfMs(tf);
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
        confirmed: time + dur <= serverTime,
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
    out.push({ symbol: r.symbol, tickSize });
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
    const candles: Candle[] = data.map((d: Record<string, unknown>) => ({
      time: Number(d.start),
      open: Number(d.open),
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
      volume: Number(d.volume),
      confirmed: d.confirm === true,
    }));
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
