import type { Candle, PriceTick, SymbolInfo, Timeframe } from '../core/types';
import type { SocketState } from './bybit/socket';

export interface FeedListener {
  /** 진행 중이거나 막 확정된 캔들 */
  onCandle(c: Candle): void;
  /** 최신 체결가 (또는 체결 수신 전에는 티커의 마지막 가격) */
  onPrice(t: PriceTick): void;
  /** 메시지 하나를 받을 때마다: 거래소 시각(없으면 null)과 받은 브라우저 시각 */
  onMessage(ts: number | null, receivedAt: number): void;
  onSocketState(s: SocketState): void;
  /** 끊겼다가 다시 열렸을 때. 앱은 이때 빠진 캔들을 REST로 메운다. */
  onReconnected(): void;
}

/** 시세 공급원. Bybit 외 다른 거래소로 바꿀 때 이 인터페이스만 구현하면 된다. */
export interface MarketDataProvider {
  listSymbols(): Promise<SymbolInfo[]>;
  /** 최신 캔들 limit개(오름차순)와 공급원 기준 현재 시각 */
  fetchCandles(symbol: string, tf: Timeframe, limit: number): Promise<{ candles: Candle[]; serverTime: number }>;
  /** 실시간 구독. 반환 함수로 해제한다. 한 번에 하나만 구독한다고 가정한다. */
  watch(symbol: string, tf: Timeframe, listener: FeedListener): () => void;
}
