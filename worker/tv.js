// /tv-watchlist/<번호> — 트레이딩뷰 「공유 목록」 공개 페이지에서 종목 이름만 꺼내 준다 (2026-11-06).
// 브라우저는 트레이딩뷰를 직접 못 부르므로(CORS) 이 워커가 대신 받는다. 열린 중계가 되지 않게:
// - 주소는 www.tradingview.com/watchlists/<숫자>/ 하나로 고정 (다른 곳은 못 부름), GET만
// - 같은 출처(우리 화면)에서만, 응답은 symbols 배열(글자만)로 다시 만들어 내보낸다 (트레이딩뷰 HTML은 넘기지 않음)
// - 받은 페이지가 너무 크면 버리고, 같은 목록은 5분 담아 둔다
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const MAX_HTML = 3_000_000;
const SYMBOL = /^[A-Za-z0-9_.!*&+\-():/^ #ㄱ-힝\u{1F300}-\u{1FAFF}☀-➿]{1,120}$/u;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS } });
}

/** 공유 목록 페이지 HTML → symbols 배열 (없으면 null) */
export function extractTvSymbols(html) {
  const m = /"symbols":(\[[^\]]{0,200000}\])/.exec(html);
  if (!m) return null;
  let list;
  try {
    list = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  return list.filter((x) => typeof x === 'string' && SYMBOL.test(x)).slice(0, 2000);
}

export async function tvWatchlist(request, upstreamFetch = fetch) {
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return json(403, { error: 'cross-site not allowed' });
  const m = /^\/tv-watchlist\/(\d{1,12})$/.exec(new URL(request.url).pathname);
  if (!m) return json(400, { error: 'bad id' });
  let res;
  try {
    res = await upstreamFetch(`https://www.tradingview.com/watchlists/${m[1]}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (1RC watchlist import)', Accept: 'text/html' },
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 300, '300-599': 0 } },
    });
  } catch {
    return json(502, { error: 'upstream unavailable' });
  }
  if (res.status === 404) return json(404, { error: '목록을 찾을 수 없어요 (공유 목록이 꺼져 있거나 번호가 틀려요)' });
  if (!res.ok) return json(502, { error: `tradingview ${res.status}` });
  const html = await res.text();
  if (html.length > MAX_HTML) return json(502, { error: 'too large' });
  const symbols = extractTvSymbols(html);
  if (!symbols) return json(422, { error: '목록을 읽지 못했어요 (공유 목록이 꺼져 있을 수 있어요)' });
  return json(200, { symbols });
}
