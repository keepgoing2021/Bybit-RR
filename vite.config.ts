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
// SITE_URL(직접 지정) → Vercel의 운영 도메인(VERCEL_PROJECT_PRODUCTION_URL, 사용자 도메인을 붙이면 그 주소) → 기본 주소
export const DEFAULT_SITE_URL = 'https://bybit-rr.vercel.app';
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/+$/, '');
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return DEFAULT_SITE_URL;
}

export default defineConfig({
  plugins: [
    {
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl()),
    },
  ],
  server: { proxy: bybitProxy },
  preview: { proxy: bybitProxy },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    isolate: false,
  },
});
