import { describe, expect, it } from 'vitest';
import type { PriceTick, Candle } from '../../src/core/types';
import { BybitProvider, type FetchLike } from '../../src/data/bybit/provider';
import type { FeedListener } from '../../src/data/provider';
import type { SocketState } from '../../src/data/bybit/socket';
import { FakeScheduler, socketFactory } from './helpers/fakes';

function fakeFetch(routes: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`no route for ${url}`);
    const r = routes[key];
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.ok === false ? 'Forbidden' : 'OK',
      json: async () => r.body,
    };
  };
  return { impl, calls };
}

function recorder() {
  const prices: PriceTick[] = [];
  const candles: Candle[] = [];
  const states: SocketState[] = [];
  const messages: [number | null, number][] = [];
  let reconnected = 0;
  const l: FeedListener = {
    onPrice: (t) => prices.push(t),
    onCandle: (c) => candles.push(c),
    onSocketState: (s) => states.push(s),
    onMessage: (ts, at) => messages.push([ts, at]),
    onReconnected: () => reconnected++,
  };
  return { l, prices, candles, states, messages, reconnected: () => reconnected };
}

function makeProvider(fetchImpl: FetchLike = fakeFetch({}).impl) {
  const scheduler = new FakeScheduler();
  const sockets = socketFactory();
  const p = new BybitProvider({
    restBases: ['/bybit-api'],
    wsUrl: 'wss://stream.bybit.com/v5/public/linear',
    fetchImpl,
    createSocket: sockets.create,
    scheduler,
    now: () => 1_000_000 + scheduler.time,
  });
  return { p, scheduler, sockets };
}

describe('BybitProvider REST', () => {
  it('requests linear klines with the max limit and returns ascending candles', async () => {
    const f = fakeFetch({
      '/v5/market/kline': {
        body: { retCode: 0, retMsg: 'OK', time: 1670610000000, result: { list: [
          ['1670608800000', '2', '3', '1', '2.5', '10', '1'],
          ['1670605200000', '1', '2', '0.5', '2', '10', '1'],
        ] } },
      },
    });
    const { p } = makeProvider(f.impl);
    const r = await p.fetchCandles('BTCUSDT', '60', 1000);
    expect(f.calls[0]).toBe('/bybit-api/v5/market/kline?category=linear&symbol=BTCUSDT&interval=60&limit=1000');
    expect(r.serverTime).toBe(1670610000000);
    expect(r.candles.map((c) => c.time)).toEqual([1670605200000, 1670608800000]);
    expect(r.candles.map((c) => c.confirmed)).toEqual([true, false]);
  });

  it('fetchCandles rejects with status', async () => {
    const { p } = makeProvider(fakeFetch({ '/v5/market/kline': { ok: false, status: 403, body: {} } }).impl);
    await expect(p.fetchCandles('BTCUSDT', '15', 1000)).rejects.toThrow('403');
  });

  it('rejects with the Bybit message when retCode is not 0', async () => {
    const { p } = makeProvider(fakeFetch({ '/v5/market/kline': { body: { retCode: 10001, retMsg: 'params error' } } }).impl);
    await expect(p.fetchCandles('BTCUSDT', '15', 1000)).rejects.toThrow('params error');
  });

  it('listSymbols follows cursor and puts major pairs first', async () => {
    const item = (symbol: string) => ({
      symbol, contractType: 'LinearPerpetual', status: 'Trading', quoteCoin: 'USDT', priceFilter: { tickSize: '0.01' },
    });
    const f = fakeFetch({
      'cursor=abc': { body: { retCode: 0, result: { list: [item('BTCUSDT'), item('AAVEUSDT')], nextPageCursor: '' } } },
      'instruments-info': { body: { retCode: 0, result: { list: [item('ZECUSDT'), item('ETHUSDT')], nextPageCursor: 'abc' } } },
    });
    const { p } = makeProvider(f.impl);
    const symbols = await p.listSymbols();
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]).toBe('/bybit-api/v5/market/instruments-info?category=linear&limit=1000');
    expect(f.calls[1]).toContain('cursor=abc');
    expect(symbols.map((s) => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'AAVEUSDT', 'ZECUSDT']);
  });
});

describe('BybitProvider WebSocket', () => {
  it('watch subscribes kline, publicTrade, tickers topics', () => {
    const { p, sockets } = makeProvider();
    p.watch('BTCUSDT', '15', recorder().l);
    sockets.latest().open();
    expect(sockets.latest().url).toBe('wss://stream.bybit.com/v5/public/linear');
    expect(sockets.latest().sentOps('subscribe')).toEqual([
      { op: 'subscribe', args: ['kline.15.BTCUSDT', 'publicTrade.BTCUSDT', 'tickers.BTCUSDT'] },
    ]);
  });

  it('routes trades, klines and message timestamps to the listener', () => {
    const { p, sockets } = makeProvider();
    const r = recorder();
    p.watch('BTCUSDT', '15', r.l);
    const s = sockets.latest();
    s.open();
    s.receive({ topic: 'publicTrade.BTCUSDT', ts: 10, type: 'snapshot', data: [
      { T: 8, p: '100.0' }, { T: 9, p: '100.5' },
    ] });
    s.receive({ topic: 'kline.15.BTCUSDT', ts: 11, type: 'snapshot', data: [
      { start: 0, end: 899999, open: '1', high: '2', low: '0.5', close: '1.5', volume: '3', confirm: true },
    ] });
    expect(r.prices).toEqual([{ price: 100.5, time: 9, source: 'trade' }]);
    expect(r.candles).toEqual([{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3, confirmed: true }]);
    expect(r.messages).toEqual([[10, 1_000_000], [11, 1_000_000]]);
  });

  it('uses the ticker last price only until the first trade arrives', () => {
    const { p, sockets } = makeProvider();
    const r = recorder();
    p.watch('BTCUSDT', '15', r.l);
    const s = sockets.latest();
    s.open();
    s.receive({ topic: 'tickers.BTCUSDT', ts: 5, type: 'snapshot', data: { lastPrice: '99.9' } });
    s.receive({ topic: 'publicTrade.BTCUSDT', ts: 6, data: [{ T: 6, p: '100' }] });
    s.receive({ topic: 'tickers.BTCUSDT', ts: 7, type: 'delta', data: { lastPrice: '100.1' } });
    expect(r.prices).toEqual([
      { price: 99.9, time: 5, source: 'ticker' },
      { price: 100, time: 6, source: 'trade' },
    ]);
  });

  it('ignores messages for other topics', () => {
    const { p, sockets } = makeProvider();
    const r = recorder();
    p.watch('BTCUSDT', '15', r.l);
    const s = sockets.latest();
    s.open();
    s.receive({ topic: 'publicTrade.ETHUSDT', ts: 6, data: [{ T: 6, p: '3000' }] });
    s.receive({ topic: 'kline.60.BTCUSDT', ts: 6, data: [{ start: 0, open: '1', high: '1', low: '1', close: '1', volume: '1', confirm: false }] });
    expect(r.prices).toEqual([]);
    expect(r.candles).toEqual([]);
  });

  it('reports reconnection after the socket reopens', () => {
    const { p, sockets, scheduler } = makeProvider();
    const r = recorder();
    p.watch('BTCUSDT', '15', r.l);
    sockets.latest().open();
    expect(r.reconnected()).toBe(0);
    sockets.latest().serverClose();
    scheduler.advance(1_000);
    sockets.latest().open();
    expect(r.reconnected()).toBe(1);
    expect(r.states).toEqual(['connecting', 'open', 'reconnecting', 'connecting', 'open']);
  });

  it('unsubscribe closes the socket', () => {
    const { p, sockets } = makeProvider();
    const stop = p.watch('BTCUSDT', '15', recorder().l);
    sockets.latest().open();
    stop();
    expect(sockets.latest().clientClosed).toBe(true);
  });
});

describe('BybitProvider REST fallback', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });
  const empty = { retCode: 0, retMsg: 'OK', time: 1, result: { list: [] } };
  const withBases = (restBases: string[], fetchImpl: FetchLike) =>
    new BybitProvider({
      restBases, wsUrl: 'wss://x', fetchImpl, createSocket: socketFactory().create, scheduler: new FakeScheduler(), now: () => 0,
    });
  const path = '/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=10';

  it('falls back to the next REST base when the first cannot be reached, then remembers it', async () => {
    const calls: string[] = [];
    const p = withBases(['https://api.bybit.com', '/bybit-api'], async (url) => {
      calls.push(url);
      if (url.startsWith('https://')) throw new TypeError('Failed to fetch');
      return ok(empty);
    });
    await p.fetchCandles('BTCUSDT', '15', 10);
    expect(calls).toEqual([`https://api.bybit.com${path}`, `/bybit-api${path}`]);
    calls.length = 0;
    await p.fetchCandles('BTCUSDT', '15', 10);
    expect(calls).toEqual([`/bybit-api${path}`]);
  });

  it('reports every base when all of them fail', async () => {
    const p = withBases(['https://api.bybit.com', '/bybit-api'], async (url) => {
      if (url.startsWith('https://')) throw new TypeError('Failed to fetch');
      return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({}) };
    });
    const err = await p.fetchCandles('BTCUSDT', '15', 10).catch((e: Error) => e);
    expect(String(err)).toContain('https://api.bybit.com');
    expect(String(err)).toContain('Failed to fetch');
    expect(String(err)).toContain('/bybit-api');
    expect(String(err)).toContain('403');
  });

  it('does not try another base when Bybit itself answers with an error code', async () => {
    const calls: string[] = [];
    const p = withBases(['https://api.bybit.com', '/bybit-api'], async (url) => {
      calls.push(url);
      return ok({ retCode: 10001, retMsg: 'params error' });
    });
    await expect(p.fetchCandles('BTCUSDT', '15', 10)).rejects.toThrow('params error');
    expect(calls).toHaveLength(1);
  });
});
