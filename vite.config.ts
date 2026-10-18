import { defineConfig } from 'vitest/config';

// 브라우저 → 이 개발 서버 → api.bybit.com 으로 REST를 중계한다.
// Bybit REST의 CORS 허용 여부를 확인하지 못했기 때문에(설계 문서 D2) 직접 호출 대신 프록시를 쓴다.
const bybitProxy = {
  '/bybit-api': {
    target: 'https://api.bybit.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/bybit-api/, ''),
  },
};

export default defineConfig({
  server: { proxy: bybitProxy },
  preview: { proxy: bybitProxy },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    isolate: false,
  },
});
