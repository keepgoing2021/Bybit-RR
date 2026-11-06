import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index.js';
import { ALLOWED, MAX_QUERY, proxy } from '../../worker/proxy.js';

const BASE = 'https://1rc.app';
type Seen = { url: string; init?: RequestInit & { cf?: unknown } };

function fakeUpstream(body = '{"retCode":0}', status = 200, contentType = 'text/html') {
  const seen: Seen[] = [];
  const f = async (url: string, init?: RequestInit & { cf?: unknown }) => {
    seen.push({ url, init });
    return new Response(body, { status, headers: { 'Content-Type': contentType, 'Set-Cookie': 'track=1' } });
  };
  return { f, seen };
}

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Request(BASE + path, { method, headers });

describe('Bybit relay (Cloudflare Worker): public market data only', () => {
  it('passes the three market endpoints the app uses, with no caller headers forwarded', async () => {
    const { f, seen } = fakeUpstream();
    const r = await proxy(
      get('/bybit-api/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=1000', {
        'Sec-Fetch-Site': 'same-origin',
        Cookie: 'session=secret',
        'X-BAPI-API-KEY': 'their-key',
        Authorization: 'Bearer x',
      }),
      f,
    );
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=1000');
    // 손님의 쿠키·API 키는 넘기지 않는다 (고정된 두 머리글만)
    expect(Object.keys(seen[0].init!.headers as Record<string, string>).sort()).toEqual(['Accept', 'User-Agent']);
    // 성공만 잠깐 담고 오류는 담지 않는다
    expect(seen[0].init!.cf).toEqual({ cacheEverything: true, cacheTtlByStatus: { '200-299': 2, '300-599': 0 } });
    for (const p of ['/v5/market/instruments-info?category=linear&limit=1000', '/v5/market/tickers?category=linear']) {
      expect((await proxy(get(`/bybit-api${p}`), f)).status).toBe(200);
    }
  });

  it('answers as JSON with safety headers whatever Bybit says, and drops its cookies', async () => {
    const { f } = fakeUpstream('<script>alert(1)</script>', 200, 'text/html');
    const r = await proxy(get('/bybit-api/v5/market/tickers?category=linear'), f);
    expect(r.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(r.headers.get('Set-Cookie')).toBeNull();
    // Bybit의 상태 코드는 그대로 (앱이 실패 이유를 보여 줄 수 있게)
    const { f: f429 } = fakeUpstream('{"retCode":10006}', 429, 'application/json');
    expect((await proxy(get('/bybit-api/v5/market/tickers?category=linear'), f429)).status).toBe(429);
  });

  it('refuses anything else: other paths, traversal, non-GET, cross-site browsers, very long queries', async () => {
    const { f, seen } = fakeUpstream();
    const cases: [Request, number][] = [
      [get('/bybit-api/v5/order/create'), 403],
      [get('/bybit-api/v5/account/wallet-balance?accountType=UNIFIED'), 403],
      [get('/bybit-api/v5/market/orderbook?category=linear&symbol=BTCUSDT'), 403], // 앱이 안 쓰는 시세
      [get('/bybit-api/v5/market/kline/../../order/create'), 403],
      [get('/bybit-api/v5/market/..%2F..%2Forder%2Fcreate'), 403],
      [get('/bybit-api/v5/market/kline%3F'), 403],
      [get('/bybit-api/v5/market/kline', {}, 'POST'), 405],
      [get('/bybit-api/v5/market/kline', {}, 'HEAD'), 405],
      [get('/bybit-api/v5/market/kline?category=linear', { 'Sec-Fetch-Site': 'cross-site' }), 403],
      [get('/bybit-api/v5/market/kline?category=linear', { 'Sec-Fetch-Site': 'same-site' }), 403],
      [get(`/bybit-api/v5/market/kline?symbol=${'A'.repeat(MAX_QUERY)}`), 414],
    ];
    for (const [req, status] of cases) {
      const r = await proxy(req, f);
      expect(r.status, req.method + ' ' + req.url).toBe(status);
      expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
    expect(seen).toHaveLength(0); // Bybit로는 한 번도 안 감
    // 주소창에 직접 친 것(none)은 통과
    expect((await proxy(get('/bybit-api/v5/market/tickers?category=linear', { 'Sec-Fetch-Site': 'none' }), f)).status).toBe(200);
  });

  it('Bybit unreachable → 502, not a crash', async () => {
    const r = await proxy(get('/bybit-api/v5/market/tickers?category=linear'), async () => {
      throw new Error('network');
    });
    expect(r.status).toBe(502);
  });

  it('everything outside /bybit-api/ is the static site', async () => {
    const assets: string[] = [];
    const env = { ASSETS: { fetch: async (req: Request) => (assets.push(new URL(req.url).pathname), new Response('page')) } };
    expect(await (await worker.fetch(get('/'), env)).text()).toBe('page');
    await worker.fetch(get('/bybit-apix/v5/market/kline'), env);
    expect(assets).toEqual(['/', '/bybit-apix/v5/market/kline']);
  });

  it('every Bybit REST path the app calls is allowed (adding a new one without the relay fails here)', () => {
    const src = readFileSync('src/data/bybit/provider.ts', 'utf8');
    const used = [...new Set([...src.matchAll(/['`](\/v5\/[a-z0-9/-]+)\?/g)].map((m) => m[1]))].sort();
    expect(used.length).toBeGreaterThanOrEqual(3);
    expect(used).toEqual(Object.keys(ALLOWED).sort());
  });

  it('the Worker entry file exports only the default handler (other exports stop the Workers runtime from starting)', async () => {
    const mod = await import('../../worker/index.js');
    expect(Object.keys(mod)).toEqual(['default']);
  });
});

describe('트레이딩뷰 공유 목록 중계 (/tv-watchlist)', async () => {
  const { extractTvSymbols, tvWatchlist } = await import('../../worker/tv.js');
  const page = '<html><script>window.x={"id":1,"symbols":["###먹을텐데","NYSE:KO","NASDAQ:SBUX","<img onerror=1>"],"name":"해외주식"}</script></html>';
  const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://1rc.app${path}`, { headers });

  it('페이지에서 종목 이름만 꺼낸다 (이상한 글자는 버림)', () => {
    expect(extractTvSymbols(page)).toEqual(['###먹을텐데', 'NYSE:KO', 'NASDAQ:SBUX']);
    expect(extractTvSymbols('<html></html>')).toBeNull();
  });

  it('트레이딩뷰 고정 주소만 부르고, 번호가 아니면 거절, 다른 사이트에서 부르면 거절', async () => {
    const calls: string[] = [];
    const up = async (u: string) => {
      calls.push(u);
      return new Response(page, { status: 200 });
    };
    const ok = await tvWatchlist(req('/tv-watchlist/16358394'), up);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ symbols: ['###먹을텐데', 'NYSE:KO', 'NASDAQ:SBUX'] });
    expect(calls).toEqual(['https://www.tradingview.com/watchlists/16358394/']);
    expect((await tvWatchlist(req('/tv-watchlist/abc'), up)).status).toBe(400);
    expect((await tvWatchlist(req('/tv-watchlist/1', { 'Sec-Fetch-Site': 'cross-site' }), up)).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it('없는 목록 404, 못 읽으면 422', async () => {
    expect((await tvWatchlist(req('/tv-watchlist/1'), async () => new Response('x', { status: 404 }))).status).toBe(404);
    expect((await tvWatchlist(req('/tv-watchlist/1'), async () => new Response('<html/>', { status: 200 }))).status).toBe(422);
  });
});

describe('미국 주식 현재가 중계 (/stock-quote, Finnhub)', async () => {
  const { stockQuote, MAX_SYMBOLS } = await import('../../worker/stocks.js');
  const req = (q: string, headers: Record<string, string> = {}) => new Request(`https://1rc.app/stock-quote${q}`, { headers });
  const env = { FINNHUB_KEY: 'secret-key' };

  it('종목마다 Finnhub에 묻고 현재가·등락%만 돌려준다, 키는 응답에 없다', async () => {
    const calls: string[] = [];
    const up = async (u: string) => {
      calls.push(u);
      const sym = new URL(u).searchParams.get('symbol');
      return new Response(JSON.stringify(sym === 'NOPE' ? { c: 0, t: 0 } : { c: 100.5, dp: -1.2, t: 1_700_000_000 }));
    };
    const r = await stockQuote(req('?s=sbux,YUM,NOPE,<bad>,brk.b'), env, up);
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ quotes: { SBUX: { c: 100.5, dp: -1.2, t: 1_700_000_000_000 }, YUM: { c: 100.5, dp: -1.2, t: 1_700_000_000_000 }, 'BRK.B': { c: 100.5, dp: -1.2, t: 1_700_000_000_000 } }, missing: ['NOPE'] });
    expect(text).not.toContain('secret-key');
    expect(calls).toHaveLength(4);
    expect(calls.every((u) => u.startsWith('https://finnhub.io/api/v1/quote?symbol='))).toBe(true);
  });

  it('키가 없으면 503, 다른 사이트에서 부르면 403, 종목이 없으면 400, 30개까지만', async () => {
    const up = async () => new Response('{"c":1,"t":1}');
    expect((await stockQuote(req('?s=SBUX'), {}, up)).status).toBe(503);
    expect((await stockQuote(req('?s=SBUX', { 'Sec-Fetch-Site': 'cross-site' }), env, up)).status).toBe(403);
    expect((await stockQuote(req('?s=<x>'), env, up)).status).toBe(400);
    let n = 0;
    await stockQuote(req(`?s=${Array.from({ length: 50 }, (_, i) => `A${i}`).join(',')}`), env, async () => (n++, new Response('{"c":1,"t":1}')));
    expect(n).toBe(MAX_SYMBOLS);
  });

  it('Finnhub가 실패한 종목만 빠진다', async () => {
    const r = await stockQuote(req('?s=AAA,BBB'), env, async (u: string) => (u.includes('AAA') ? new Response('x', { status: 429 }) : new Response('{"c":2,"dp":1,"t":5}')));
    expect(await r.json()).toEqual({ quotes: { BBB: { c: 2, dp: 1, t: 5000 } }, missing: [] }); // 429는 「없음」이 아니라 다음에 다시
  });
});
