/** 공급원 연결 설정. 다른 도메인을 써야 하면 여기만 바꾼다. */
export const CONFIG = {
  bybit: {
    /** 개발 서버 프록시 경로 (vite.config.ts) → https://api.bybit.com */
    restBase: '/bybit-api',
    wsUrl: 'wss://stream.bybit.com/v5/public/linear',
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
