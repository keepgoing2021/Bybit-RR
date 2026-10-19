export type Side = 'LONG' | 'SHORT';

/** Bybit kline interval 값. 월봉(M)은 길이가 일정하지 않아 제외한다. */
export type Timeframe = '1' | '3' | '5' | '15' | '30' | '60' | '120' | '240' | '360' | '720' | 'D' | 'W' | 'M';

export interface Candle {
  /** 캔들 시작 시각 (ms, UTC epoch) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 거래대금 (USDT). 실시간 푸시에만 있고, 5분 순위판에서 쓴다 */
  turnover?: number;
  /** 공급원이 확정(마감)으로 표시한 캔들인지 */
  confirmed: boolean;
}

/** 24시간 시세 요약 (종목 목록 정렬·표시용) */
export interface TickerStat {
  symbol: string;
  lastPrice: number;
  /** 24시간 등락 % (예: 0.99 = +0.99%) */
  changePct: number;
  /** 24시간 거래대금 (USDT) */
  turnover24h: number;
}

export interface SymbolInfo {
  symbol: string;
  tickSize: number;
  /** 주문 수량 단위 (Bybit lotSizeFilter.qtyStep) */
  qtyStep?: number;
  /** 최소 주문 수량 (lotSizeFilter.minOrderQty) */
  minQty?: number;
  /** 최소 주문 금액 USDT (lotSizeFilter.minNotionalValue) */
  minNotional?: number;
}

export interface PriceTick {
  price: number;
  /** 거래소 기준 가격 시각 (ms) */
  time: number;
  source: 'trade' | 'ticker';
}
