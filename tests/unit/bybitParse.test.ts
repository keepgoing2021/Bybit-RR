import { describe, expect, it } from 'vitest';
import { parseInstruments, parseKlineList, parseTickers, parseWsMessage } from '../../src/data/bybit/parse';

// Bybit V5 문서 형식: result.list는 최신순, 항목은 [start, open, high, low, close, volume, turnover] 문자열
const REST_LIST = [
  ['1670608800000', '17071', '17073', '17027', '17055.5', '268611', '15.74462667'],
  ['1670605200000', '17071.5', '17072', '17061', '17071', '4177', '0.24469757'],
  ['1670601600000', '17086.5', '17088', '16978', '17071.5', '6356', '0.37288112'],
];

describe('parseKlineList', () => {
  it('monthly candles close at the end of the calendar month', () => {
    const rows = [[String(Date.UTC(2026, 2, 1)), '2', '3', '1', '2', '5', '9'], [String(Date.UTC(2026, 1, 1)), '1', '3', '1', '2', '5', '9']];
    const c = parseKlineList(rows, Date.UTC(2026, 2, 2), 'M');
    expect(c.map((x) => x.confirmed)).toEqual([true, false]);
  });

  it('returns candles in ascending time order with numbers', () => {
    const c = parseKlineList(REST_LIST, 1670608800000 + 30 * 60_000, '60');
    expect(c.map((x) => x.time)).toEqual([1670601600000, 1670605200000, 1670608800000]);
    expect(c[2]).toMatchObject({ open: 17071, high: 17073, low: 17027, close: 17055.5, volume: 268611 });
  });

  it('marks candles confirmed only when their period ended by the server time', () => {
    const c = parseKlineList(REST_LIST, 1670608800000 + 30 * 60_000, '60');
    expect(c.map((x) => x.confirmed)).toEqual([true, true, false]);
    const later = parseKlineList(REST_LIST, 1670608800000 + 60 * 60_000, '60');
    expect(later[2].confirmed).toBe(true);
  });
});

describe('parseInstruments', () => {
  it('reads the order size rules from lotSizeFilter', () => {
    const list = [{
      symbol: 'BTCUSDT', contractType: 'LinearPerpetual', status: 'Trading', quoteCoin: 'USDT', priceFilter: { tickSize: '0.10' },
      lotSizeFilter: { maxOrderQty: '1190.000', minOrderQty: '0.001', qtyStep: '0.001', minNotionalValue: '5' },
    }];
    expect(parseInstruments(list)).toEqual([{ symbol: 'BTCUSDT', tickSize: 0.1, qtyStep: 0.001, minQty: 0.001, minNotional: 5 }]);
  });

  it('keeps only trading USDT perpetuals with their tick size', () => {
    const list = [
      { symbol: 'BTCUSDT', contractType: 'LinearPerpetual', status: 'Trading', quoteCoin: 'USDT', priceFilter: { tickSize: '0.10' } },
      { symbol: 'PEPEUSDT', contractType: 'LinearPerpetual', status: 'Trading', quoteCoin: 'USDT', priceFilter: { tickSize: '0.0000001' } },
      { symbol: 'BTCPERP', contractType: 'LinearPerpetual', status: 'Trading', quoteCoin: 'USDC', priceFilter: { tickSize: '0.5' } },
      { symbol: 'BTCUSDT-26DEC26', contractType: 'LinearFutures', status: 'Trading', quoteCoin: 'USDT', priceFilter: { tickSize: '0.5' } },
      { symbol: 'NEWUSDT', contractType: 'LinearPerpetual', status: 'PreLaunch', quoteCoin: 'USDT', priceFilter: { tickSize: '0.001' } },
      { symbol: 'BADUSDT', contractType: 'LinearPerpetual', status: 'Trading', quoteCoin: 'USDT', priceFilter: { tickSize: 'x' } },
    ];
    expect(parseInstruments(list)).toEqual([
      { symbol: 'BTCUSDT', tickSize: 0.1 },
      { symbol: 'PEPEUSDT', tickSize: 0.0000001 },
    ]);
  });
});

describe('parseWsMessage', () => {
  it('parses the documented kline push', () => {
    const raw = JSON.stringify({
      topic: 'kline.5.BTCUSDT',
      data: [{
        start: 1672324800000, end: 1672325099999, interval: '5', open: '16649.5', close: '16677', high: '16677',
        low: '16608', volume: '2.081', turnover: '34666.4005', confirm: false, timestamp: 1672324988882,
      }],
      ts: 1672324988882,
      type: 'snapshot',
    });
    const { event, ts } = parseWsMessage(raw);
    expect(ts).toBe(1672324988882);
    expect(event).toEqual({
      type: 'kline',
      topic: 'kline.5.BTCUSDT',
      candles: [{ time: 1672324800000, open: 16649.5, high: 16677, low: 16608, close: 16677, volume: 2.081, turnover: 34666.4005, confirmed: false }],
    });
  });

  it('parses the documented public trade push', () => {
    const raw = JSON.stringify({
      topic: 'publicTrade.BTCUSDT',
      type: 'snapshot',
      ts: 1672304486868,
      data: [{ T: 1672304486865, s: 'BTCUSDT', S: 'Buy', v: '0.001', p: '16578.50', L: 'PlusTick', i: '20f4', BT: false, seq: 1 }],
    });
    const { event, ts } = parseWsMessage(raw);
    expect(ts).toBe(1672304486868);
    expect(event).toEqual({
      type: 'trade',
      topic: 'publicTrade.BTCUSDT',
      ticks: [{ price: 16578.5, time: 1672304486865, source: 'trade' }],
    });
  });

  it('ticker delta without lastPrice gives null', () => {
    const { event } = parseWsMessage(JSON.stringify({ topic: 'tickers.BTCUSDT', type: 'delta', ts: 5, cs: 1, data: { markPrice: '1' } }));
    expect(event).toEqual({ type: 'ticker', topic: 'tickers.BTCUSDT', lastPrice: null, ts: 5 });
  });

  it('ticker snapshot carries lastPrice', () => {
    const { event } = parseWsMessage(JSON.stringify({ topic: 'tickers.BTCUSDT', type: 'snapshot', ts: 7, data: { lastPrice: '65000.1' } }));
    expect(event).toEqual({ type: 'ticker', topic: 'tickers.BTCUSDT', lastPrice: 65000.1, ts: 7 });
  });

  it('recognizes pong replies', () => {
    expect(parseWsMessage('{"success":true,"ret_msg":"pong","conn_id":"x","op":"ping"}').event).toEqual({ type: 'pong' });
    expect(parseWsMessage('{"op":"pong","args":["1"]}').event).toEqual({ type: 'pong' });
  });

  it('recognizes subscribe acknowledgements', () => {
    expect(parseWsMessage('{"success":false,"ret_msg":"error:handler not found","op":"subscribe","conn_id":"x"}').event)
      .toEqual({ type: 'ack', success: false, message: 'error:handler not found' });
  });

  it('treats garbage as unknown', () => {
    expect(parseWsMessage('not json')).toEqual({ event: { type: 'unknown' }, ts: null });
  });
});

describe('parseTickers (GET /v5/market/tickers?category=linear)', () => {
  it('reads last price, 24h change (ratio → %) and 24h turnover; skips broken rows', () => {
    expect(
      parseTickers([
        { symbol: 'BTCUSDT', lastPrice: '82452.6', price24hPcnt: '0.0099', turnover24h: '8270000000.12', volume24h: '100' },
        { symbol: 'QUSDT', lastPrice: '0.109215', price24hPcnt: '-0.1391', turnover24h: '1060000000' },
        { symbol: 'NEWUSDT', lastPrice: '1.5', price24hPcnt: '', turnover24h: '' },
        { symbol: 'BAD', lastPrice: 'x' },
        null,
        { lastPrice: '1' },
      ]),
    ).toEqual([
      { symbol: 'BTCUSDT', lastPrice: 82452.6, changePct: 0.99, turnover24h: 8270000000.12 },
      { symbol: 'QUSDT', lastPrice: 0.109215, changePct: -13.91, turnover24h: 1060000000 },
      { symbol: 'NEWUSDT', lastPrice: 1.5, changePct: 0, turnover24h: 0 },
    ]);
  });
});
