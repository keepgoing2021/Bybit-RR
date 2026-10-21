// /bybit-api/* 중계 (worker/index.js가 부른다). 시험에서 바로 불러 쓰려고 따로 둔 파일.
// 진입 파일(index.js)은 default 하나만 내보내야 한다: Workers 런타임은 진입 파일의 이름 있는 내보내기를
// 모두 처리기로 읽어서, 숫자·객체를 내보내면 시작하지 못한다 ("Incorrect type for map entry").
//
// 열린 중계가 되지 않게 (2026-10-21 보안 점검):
// - 앱이 실제로 부르는 공개 시세 주소 3개만, GET만 통과 (나머지 403·405)
// - 손님의 머리글(쿠키·API 키 등)은 하나도 넘기지 않는다 → 이 중계로 개인 API를 부를 수 없다
// - 다른 사이트가 방문자 브라우저로 이 중계를 부르면 거절 (Sec-Fetch-Site)
// - 질의가 비정상적으로 길면 거절, Bybit 응답은 늘 JSON으로만 내보낸다 (HTML로 읽히지 않게)
// - 같은 질의는 Cloudflare 가장자리에 잠깐 담아 Bybit로 가는 요청을 줄인다 (오류 응답은 담지 않음)
const BYBIT = 'https://api.bybit.com';

/** 앱이 부르는 주소 → 가장자리 캐시 초 (종목 정보는 거의 안 바뀌어 5분, 시세는 2초) */
export const ALLOWED = {
  '/v5/market/instruments-info': 300,
  '/v5/market/tickers': 2,
  '/v5/market/kline': 2,
};

/** 질의 문자열 최대 길이 (앱이 쓰는 가장 긴 질의도 200자 안팎) */
export const MAX_QUERY = 512;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function deny(status, text) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } });
}

/** /bybit-api/* 요청 하나를 처리 (시험에서는 upstream 대신 가짜 fetch를 넣는다) */
export async function proxy(request, upstreamFetch = fetch) {
  const url = new URL(request.url);
  const path = url.pathname.slice('/bybit-api'.length);
  if (request.method !== 'GET') return deny(405, 'method not allowed');
  // 브라우저가 붙이는 출처 표시: 우리 화면(same-origin)이나 주소창 직접 입력(none)만
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return deny(403, 'cross-site not allowed');
  if (!Object.hasOwn(ALLOWED, path)) return deny(403, 'not allowed');
  if (url.search.length > MAX_QUERY) return deny(414, 'query too long');
  const ttl = ALLOWED[path];
  let upstream;
  try {
    upstream = await upstreamFetch(BYBIT + path + url.search, {
      headers: { Accept: 'application/json', 'User-Agent': '1RC-proxy' },
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '300-599': 0 } },
    });
  } catch {
    return deny(502, 'upstream unavailable');
  }
  // 쿠키 등 Bybit 머리글은 넘기지 않는다 — 몸통과 상태만, 형식은 늘 JSON
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
  });
}
