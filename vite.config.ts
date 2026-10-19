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
    ],
    server: { proxy: bybitProxy },
    preview: { proxy: bybitProxy },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node' as const,
      isolate: false,
    },
  };
});
