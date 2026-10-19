// E2E용 가짜 Bybit V5 서버. 공식 문서의 응답 형식을 따른다 (실제 Bybit 아님).
// REST: GET /v5/market/instruments-info, GET /v5/market/kline, GET /v5/market/tickers
// WS:   /v5/public/linear — subscribe/ping 응답, publicTrade·tickers·kline 푸시
// 시험용: POST /mock/drop (모든 웹소켓 강제 종료), GET /mock/stats,
//        POST /mock/fail?route=instruments|kline[&interval=60] (해당 REST를 HTTP 403으로), POST /mock/reset,
//        POST /mock/kline-every?ms=5000 (kline 푸시 간격. Bybit 문서상 1~60초)
import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.MOCK_BYBIT_PORT ?? 5299);
const INTERVAL_MS = { 1: 60e3, 3: 180e3, 5: 300e3, 15: 900e3, 30: 1800e3, 60: 3600e3, 120: 7200e3, 240: 14400e3, 360: 21600e3, 720: 43200e3, D: 864e5, W: 6048e5 };
const SYMBOLS = {
  BTCUSDT: { tick: 0.1, base: 65000 },
  ETHUSDT: { tick: 0.01, base: 3200 },
  SOLUSDT: { tick: 0.01, base: 150 },
};
// 24시간 요약 (GET /v5/market/tickers): 거래대금 BTC > ETH > SOL, 등락률 SOL > ETH > BTC
// 실시간 캔들 거래대금 (5분 순위판 시험용): BTC > ETH > SOL
const KLINE_TURNOVER = { BTCUSDT: '900000', ETHUSDT: '500000', SOLUSDT: '300000' };

const TICKERS = {
  BTCUSDT: { price24hPcnt: '-0.0081', turnover24h: '8270000000.5' },
  ETHUSDT: { price24hPcnt: '0.0049', turnover24h: '6570000000' },
  SOLUSDT: { price24hPcnt: '0.1391', turnover24h: '1250000000' },
};

const price = (sym, t) => {
  const { base, tick } = SYMBOLS[sym];
  const p = base * (1 + 0.01 * Math.sin(t / 3.6e6) + 0.004 * Math.sin(t / 4e5) + 0.0015 * Math.sin(t / 3.1e4));
  const d = Math.max(0, -Math.floor(Math.log10(tick)));
  return Number((Math.round(p / tick) * tick).toFixed(d));
};
const fmt = (sym, p) => p.toFixed(Math.max(0, -Math.floor(Math.log10(SYMBOLS[sym].tick))));

function candle(sym, interval, start, until) {
  const dur = INTERVAL_MS[interval];
  const end = Math.min(start + dur, until);
  const n = 24;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = 0; k <= n; k++) {
    const p = price(sym, start + ((end - start) * k) / n);
    hi = Math.max(hi, p);
    lo = Math.min(lo, p);
  }
  return { start, open: price(sym, start), high: hi, low: lo, close: price(sym, end), confirm: start + dur <= until };
}

const stats = { connections: 0, subscribes: [], pings: 0 };
const failures = { instruments: false, klineIntervals: new Set() };
const cadence = { klineEveryMs: 200 };
const sockets = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/mock/drop' && req.method === 'POST') {
    for (const ws of sockets) ws.terminate();
    return json({ dropped: true });
  }
  if (url.pathname === '/mock/stats') return json(stats);
  if (url.pathname === '/mock/fail' && req.method === 'POST') {
    const route = url.searchParams.get('route');
    if (route === 'instruments') failures.instruments = true;
    if (route === 'kline') failures.klineIntervals.add(url.searchParams.get('interval'));
    return json({ ok: true });
  }
  if (url.pathname === '/mock/kline-every' && req.method === 'POST') {
    cadence.klineEveryMs = Number(url.searchParams.get('ms') ?? 200);
    return json({ ok: true });
  }
  if (url.pathname === '/mock/reset' && req.method === 'POST') {
    cadence.klineEveryMs = 200;
    failures.instruments = false;
    failures.klineIntervals.clear();
    return json({ ok: true });
  }
  const forbidden = () => {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
  };
  if (url.pathname === '/v5/market/instruments-info' && failures.instruments) return forbidden();
  if (url.pathname === '/v5/market/kline' && failures.klineIntervals.has(url.searchParams.get('interval'))) return forbidden();
  if (url.pathname === '/v5/market/instruments-info') {
    const item = (symbol, tick, extra = {}) => ({
      symbol, contractType: 'LinearPerpetual', status: 'Trading', baseCoin: symbol.replace('USDT', ''), quoteCoin: 'USDT',
      priceScale: String(Math.max(0, -Math.floor(Math.log10(tick)))), priceFilter: { minPrice: String(tick), maxPrice: '1999999.80', tickSize: String(tick) },
      lotSizeFilter: { maxOrderQty: '1190.000', minOrderQty: '0.001', qtyStep: '0.001', minNotionalValue: '5' }, ...extra,
    });
    return json({
      retCode: 0, retMsg: 'OK', time: Date.now(), retExtInfo: {},
      result: {
        category: 'linear', nextPageCursor: '',
        list: [
          item('BTCUSDT', 0.1), item('ETHUSDT', 0.01), item('SOLUSDT', 0.01),
          item('BTCPERP', 0.5, { quoteCoin: 'USDC' }), item('NEWUSDT', 0.001, { status: 'PreLaunch' }),
        ],
      },
    });
  }
  if (url.pathname === '/v5/market/tickers') {
    const now = Date.now();
    const row = (symbol) => ({ symbol, lastPrice: fmt(symbol, price(symbol, now)), ...TICKERS[symbol], volume24h: '1000', fundingRate: '0.0001' });
    // USDC 무기한(BTCPERP)도 실제처럼 섞여 온다 → 앱은 USDT 무기한 목록에 있는 것만 쓴다
    return json({
      retCode: 0, retMsg: 'OK', time: now, retExtInfo: {},
      result: { category: 'linear', list: [...Object.keys(SYMBOLS).map(row), { symbol: 'BTCPERP', lastPrice: '65000.0', price24hPcnt: '0.5', turnover24h: '99999999999' }] },
    });
  }
  if (url.pathname === '/v5/market/kline') {
    const sym = url.searchParams.get('symbol');
    const interval = url.searchParams.get('interval');
    const limit = Math.min(1000, Number(url.searchParams.get('limit') ?? 200));
    if (!SYMBOLS[sym] || !INTERVAL_MS[interval]) return json({ retCode: 10001, retMsg: 'params error', result: {} });
    const now = Date.now();
    const dur = INTERVAL_MS[interval];
    const last = Math.floor(now / dur) * dur;
    const list = [];
    for (let i = 0; i < limit; i++) {
      const c = candle(sym, interval, last - i * dur, now);
      list.push([String(c.start), fmt(sym, c.open), fmt(sym, c.high), fmt(sym, c.low), fmt(sym, c.close), '12.5', '800000']);
    }
    return json({ retCode: 0, retMsg: 'OK', time: now, retExtInfo: {}, result: { category: 'linear', symbol: sym, list } });
  }
  json({ retCode: 404, retMsg: 'not found' }, 404);
});

const wss = new WebSocketServer({ server, path: '/v5/public/linear' });
wss.on('connection', (ws) => {
  stats.connections++;
  sockets.add(ws);
  const topics = new Set();
  const lastStart = new Map();
  let lastKlineAt = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    const sendKline = now - lastKlineAt >= cadence.klineEveryMs;
    if (sendKline) lastKlineAt = now;
    for (const topic of topics) {
      const [kind, a, b] = topic.split('.');
      if (kind === 'publicTrade' && SYMBOLS[a]) {
        ws.send(JSON.stringify({ topic, type: 'snapshot', ts: now, data: [{ T: now - 3, s: a, S: 'Buy', v: '0.01', p: fmt(a, price(a, now)), L: 'PlusTick', i: String(now), BT: false, seq: now }] }));
      } else if (kind === 'tickers' && SYMBOLS[a]) {
        ws.send(JSON.stringify({ topic, type: 'delta', ts: now, cs: now, data: { symbol: a, markPrice: fmt(a, price(a, now)) } }));
      } else if (kind === 'kline' && sendKline && SYMBOLS[b] && INTERVAL_MS[a]) {
        const dur = INTERVAL_MS[a];
        const start = Math.floor(now / dur) * dur;
        const prev = lastStart.get(topic);
        const items = [];
        if (prev !== undefined && prev < start) items.push(candle(b, a, prev, now));
        items.push(candle(b, a, start, now));
        lastStart.set(topic, start);
        ws.send(JSON.stringify({
          topic, type: 'snapshot', ts: now,
          data: items.map((c) => ({
            start: c.start, end: c.start + dur - 1, interval: a, open: fmt(b, c.open), close: fmt(b, c.close), high: fmt(b, c.high),
            low: fmt(b, c.low), volume: '1.5', turnover: KLINE_TURNOVER[b] ?? '90000', confirm: c.confirm, timestamp: now,
          })),
        }));
      }
    }
  }, 200);
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.op === 'subscribe') {
      for (const t of m.args ?? []) topics.add(t);
      stats.subscribes.push(m.args);
      ws.send(JSON.stringify({ success: true, ret_msg: '', conn_id: 'mock', req_id: m.req_id, op: 'subscribe' }));
      for (const t of m.args ?? []) {
        const [kind, a] = t.split('.');
        if (kind === 'tickers' && SYMBOLS[a]) {
          ws.send(JSON.stringify({ topic: t, type: 'snapshot', ts: Date.now(), cs: 1, data: { symbol: a, lastPrice: fmt(a, price(a, Date.now() - 1000)) } }));
        }
      }
    } else if (m.op === 'unsubscribe') {
      for (const t of m.args ?? []) topics.delete(t);
      ws.send(JSON.stringify({ success: true, ret_msg: '', conn_id: 'mock', req_id: m.req_id, op: 'unsubscribe' }));
    } else if (m.op === 'ping') {
      stats.pings++;
      ws.send(JSON.stringify({ success: true, ret_msg: 'pong', conn_id: 'mock', req_id: m.req_id, op: 'ping' }));
    }
  });
  ws.on('close', () => {
    clearInterval(timer);
    sockets.delete(ws);
  });
});

server.listen(PORT, () => console.log(`mock bybit on http://localhost:${PORT}`));
