// /stock-quote?s=SBUX,YUM — 미국 주식·ETF 현재가 (Finnhub, 2026-11-07). Bybit에 없는 종목의 「시세 없음」을 채운다.
// - 키(FINNHUB_KEY)는 Cloudflare 비밀값. 응답·오류에 절대 넣지 않는다
// - 같은 출처(우리 화면)의 fetch만(Sec-Fetch-Site: same-origin 필수) + IP당 1분 횟수 제한, GET만, 종목은 티커 모양(대문자·점·하이픈)만 한 번에 30개까지
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
  // 우리 화면의 fetch만 (2026-11-11): 브라우저는 늘 Sec-Fetch-Site를 붙인다. 머리글이 없는 요청(스크립트·curl)도 거절해
  // 아무 종목이나 넣어 Finnhub 무료 한도를 태우는 걸 막는다. 머리글은 흉내 낼 수 있으므로 아래 횟수 제한도 같이 둔다
  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') return json(403, { error: 'same-origin only' });
  const key = env && env.FINNHUB_KEY;
  if (!key) return json(503, { error: 'stock quotes not configured' });
  // 한 주소(IP)당 1분 QUOTE_LIMIT번 (wrangler.jsonc ratelimits). 화면은 20초에 한 번 = 1분 3번만 부른다
  const limiter = env.QUOTE_LIMIT;
  if (limiter) {
    try {
      const { success } = await limiter.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return json(429, { error: 'too many requests' });
    } catch {
      // 제한기가 고장 나도 시세는 보여 준다
    }
  }
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
