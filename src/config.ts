/** 공급원 연결 설정. 다른 도메인을 써야 하면 여기만 바꾼다. */
export const CONFIG = {
  bybit: {
    /**
     * REST 주소 후보 (앞에서부터 시도).
     * - npm run dev: 개발 서버 중계(/bybit-api, vite.config.ts)
     * - 배포 빌드: 브라우저가 Bybit를 직접 호출하고, 막히면 /bybit-api 중계(vercel.json)로 재시도
     * - VITE_BYBIT_REST를 지정하면 그 주소만 쓴다
     */
    restBases: import.meta.env.VITE_BYBIT_REST
      ? [import.meta.env.VITE_BYBIT_REST as string]
      : import.meta.env.DEV
        ? ['/bybit-api']
        : ['https://api.bybit.com', '/bybit-api'],
    /** VITE_BYBIT_WS: E2E에서 가짜 Bybit 서버로 바꿀 때만 쓴다 */
    wsUrl: (import.meta.env.VITE_BYBIT_WS as string | undefined) || 'wss://stream.bybit.com/v5/public/linear',
  },
  /** 차트·분석에 불러올 캔들 수 (Bybit REST 최대 1000) */
  historyLimit: 1000,
  pingIntervalMs: 10_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
  /** 열린 소켓에서 이 시간 동안 아무것도 오지 않으면 끊고 다시 연결 */
  socketSilenceMs: 30_000,
  /** 데모 공급원 가격 갱신 간격 */
  demoTickMs: 250,
} as const;
