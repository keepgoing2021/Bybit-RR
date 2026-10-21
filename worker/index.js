// Cloudflare Workers — 화면(dist/)은 그대로 내보내고, /bybit-api/* 만 Bybit로 중계한다.
// Vercel의 rewrites(vercel.json)를 옮긴 것(2026-10-19 Vercel → Cloudflare 이사).
// 브라우저는 먼저 Bybit를 직접 부르고, 막히면 이 중계로 재시도한다(src/config.ts).
// 중계 규칙은 worker/proxy.js (공개 시세 3개 주소, GET만, 머리글 안 넘김, 같은 출처만).
// 이 파일은 default 하나만 내보낸다 — 이름 있는 내보내기를 Workers가 처리기로 읽어 시작에 실패한다.
import { proxy } from './proxy.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/bybit-api/')) return env.ASSETS.fetch(request);
    return proxy(request);
  },
};
