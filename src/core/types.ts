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
  /** 공급원이 확정(마감)으로 표시한 캔들인지 */
  confirmed: boolean;
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
