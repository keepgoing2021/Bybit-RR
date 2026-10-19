// Cloudflare Workers — 화면(dist/)은 그대로 내보내고, /bybit-api/* 만 Bybit로 중계한다.
// Vercel의 rewrites(vercel.json)를 옮긴 것(2026-10-19 Vercel → Cloudflare 이사).
// 브라우저는 먼저 Bybit를 직접 부르고, 막히면 이 중계로 재시도한다(src/config.ts).
// 열린 중계가 되지 않게 **공개 시세 조회(GET /v5/market/*)만** 통과시킨다.
const BYBIT = "https://api.bybit.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/bybit-api/")) return env.ASSETS.fetch(request);

    const path = url.pathname.slice("/bybit-api".length);
    if (request.method !== "GET" || !path.startsWith("/v5/market/")) {
      return new Response("not allowed", { status: 403 });
    }
    const upstream = await fetch(BYBIT + path + url.search, {
      headers: { Accept: "application/json", "User-Agent": "1RC-proxy" },
    });
    // 쿠키 등은 넘기지 않는다 — 몸통과 형식만
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  },
};
