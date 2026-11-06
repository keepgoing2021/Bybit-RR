// /stock-quote?s=SBUX,YUM — 미국 주식·ETF 현재가 (Finnhub, 2026-11-07). Bybit에 없는 종목의 「시세 없음」을 채운다.
// - 키(FINNHUB_KEY)는 Cloudflare 비밀값. 응답·오류에 절대 넣지 않는다
// - 같은 출처(우리 화면)에서만, GET만, 종목은 티커 모양(대문자·점·하이픈)만 한 번에 30개까지
// - 종목마다 Cloudflare 가장자리에 2분 담아 여러 사람이 봐도 Finnhub 호출은 2분에 한 번 (무료 1분 60번·1초 30번)
// - 한꺼번에 5개씩만 물어본다 (1초 30번 한도에 걸리지 않게)
// - 무료 플랜은 캔들(차트)이 없어 현재가·등락%만
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
export const MAX_SYMBOLS = 30;
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS } });
}

export async function stockQuote(request, env, upstreamFetch = fetch) {
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return json(403, { error: 'cross-site not allowed' });
  const key = env && env.FINNHUB_KEY;
  if (!key) return json(503, { error: 'stock quotes not configured' });
  const raw = new URL(request.url).searchParams.get('s') ?? '';
  const symbols = [...new Set(raw.split(',').map((x) => x.trim().toUpperCase()).filter((x) => TICKER.test(x)))].slice(0, MAX_SYMBOLS);
  if (!symbols.length) return json(400, { error: 'no symbols' });
  const quotes = {};
  // Finnhub가 「그런 종목 없음」(c=0)이라고 답한 것 — 상장폐지·이름 변경일 가능성. 한도 초과(429) 같은 실패와 구분
  const missing = [];
  const one = async (s) => {
      try {
        const r = await upstreamFetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`, {
          headers: { Accept: 'application/json' },
          cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 120, '300-599': 0 } },
        });
        if (!r.ok) return;
        const q = await r.json();
        // 없는 종목은 c=0, t=0으로 온다
        if (typeof q.c === 'number' && q.c > 0 && typeof q.t === 'number' && q.t > 0) {
          quotes[s] = { c: q.c, dp: typeof q.dp === 'number' ? q.dp : null, t: q.t * 1000 };
        } else missing.push(s);
      } catch {
        // 그 종목만 빠진다
      }
  };
  for (let i = 0; i < symbols.length; i += 5) await Promise.all(symbols.slice(i, i + 5).map(one));
  return json(200, { quotes, missing });
}
