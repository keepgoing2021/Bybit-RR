import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

// 브라우저 → 이 개발 서버 → api.bybit.com 으로 REST를 중계한다.
// Bybit REST의 CORS 허용 여부를 확인하지 못했기 때문에(설계 문서 D2) 직접 호출 대신 프록시를 쓴다.
// BYBIT_REST_TARGET: E2E에서 가짜 Bybit 서버로 바꿀 때만 쓴다.
const bybitProxy = {
  '/bybit-api': {
    target: process.env.BYBIT_REST_TARGET ?? 'https://api.bybit.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/bybit-api/, ''),
  },
};

// 공유 미리보기(og:image 등)는 절대 주소가 필요하다. index.html의 %SITE_URL%을 빌드 때 바꾼다:
// SITE_URL(직접 지정) → 기본 주소(1rc.app, Cloudflare Workers — 2026-10-19 Vercel에서 이사)
export const DEFAULT_SITE_URL = 'https://1rc.app';
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/+$/, '');
  return DEFAULT_SITE_URL;
}

// 배포 확인용: index.html의 %BUILD_ID%(<meta name="1rc-build">)에 커밋 앞 7자리.
// Cloudflare 자동 배포(Workers Builds)는 WORKERS_CI_COMMIT_SHA를 주고, 그 밖에는 git에서 읽는다
export function buildId(
  env: Record<string, string | undefined> = process.env,
  git: () => string = () => execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
): string {
  if (env.WORKERS_CI_COMMIT_SHA) return env.WORKERS_CI_COMMIT_SHA.slice(0, 7);
  try {
    return git().trim().slice(0, 7) || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig(() => {
  const build = buildId();
  return {
    plugins: [
      {
        name: 'site-url',
        transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', siteUrl()).replaceAll('%BUILD_ID%', build),
      },
      {
        // 개발 서버에서도 /journal 주소가 저널 페이지로 (배포는 Cloudflare가 journal.html로 알아서)
        name: 'journal-route',
        configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
          server.middlewares.use((req, _res, next) => {
            if (req.url === '/journal' || req.url?.startsWith('/journal?')) req.url = req.url.replace('/journal', '/journal.html');
            next();
          });
          // /stock-quote는 Finnhub 키(Cloudflare 비밀값)가 있어야 해서 개발 서버에선 503 — 화면 확인용으로 MOCK_STOCKS=1이면 가짜 값
          server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/stock-quote')) return next();
            const out = res as { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void };
            out.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (!process.env.MOCK_STOCKS) {
              out.statusCode = 503;
              out.end('{"error":"stock quotes not configured"}');
              return;
            }
            const syms = new URL(req.url, 'http://x').searchParams.get('s')?.split(',') ?? [];
            const quotes = Object.fromEntries(syms.map((t, i) => [t, { c: 50 + i * 3.21, dp: ((i % 5) - 2) * 0.73, t: Date.now() }]));
            out.statusCode = 200;
            out.end(JSON.stringify({ quotes }));
          });
          server.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith('/tv-watchlist/')) return next();
            const { tvWatchlist } = await import('./worker/tv.js');
            const r = await tvWatchlist(new Request(`http://localhost${req.url}`));
            const out = res as { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void };
            out.statusCode = r.status;
            out.setHeader('Content-Type', 'application/json; charset=utf-8');
            out.end(await r.text());
          });
        },
      },
    ],
    // 두 페이지: 계산기(/) + 거래 저널(/journal, 2026-11-06). Cloudflare 정적 파일은 /journal → journal.html
    build: { rollupOptions: { input: { main: 'index.html', journal: 'journal.html' } } },
    server: { proxy: bybitProxy },
    preview: { proxy: bybitProxy },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node' as const,
      isolate: false,
    },
  };
});
