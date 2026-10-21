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
