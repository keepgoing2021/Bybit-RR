import { snapToTick } from '../../core/price';
import { barStart } from '../../core/timeframe';
import type { Candle, SymbolInfo, Timeframe } from '../../core/types';
import type { Scheduler } from '../bybit/socket';
import type { FeedListener, MarketDataProvider } from '../provider';
import { DEMO_SYMBOLS, demoCandleAt, demoCandles, demoPrice, demoSymbolInfo } from './generator';

export interface DemoProviderOptions {
  /** 데모 '거래소' 시각 (배속 적용 가능) */
  now: () => number;
  /** 브라우저 시계 */
  realNow: () => number;
  scheduler: Scheduler;
  tickMs?: number;
}

const CONNECT_DELAY_MS = 300;

/** 시드 고정 합성 데이터 공급원. 화면에 DEMO 표시가 항상 붙는다. */
export class DemoProvider implements MarketDataProvider {
  readonly kind = 'demo' as const;
  readonly isDemo = true;
  private stopActive: (() => void) | null = null;
  private disconnectActive: ((ms: number) => void) | null = null;

  constructor(private readonly o: DemoProviderOptions) {}

  async listSymbols(): Promise<SymbolInfo[]> {
    // 데모 주문 규칙은 Bybit 같은 종목과 비슷한 값 (최소 주문 금액 5 USDT)
    return DEMO_SYMBOLS.map(({ symbol, tickSize, qtyStep }) => ({ symbol, tickSize, qtyStep, minQty: qtyStep, minNotional: 5 }));
  }

  async fetchCandles(symbol: string, tf: Timeframe, limit: number): Promise<{ candles: Candle[]; serverTime: number }> {
    const info = demoSymbolInfo(symbol);
    if (!info) throw new Error(`데모 종목 아님: ${symbol}`);
    const now = this.o.now();
    return { candles: demoCandles(info.seed, tf, now, limit, info.tickSize, info.base), serverTime: now };
  }

  watch(symbol: string, tf: Timeframe, l: FeedListener): () => void {
    this.stopActive?.();
    const info = demoSymbolInfo(symbol);
    const s = this.o.scheduler;
    let interval: number | null = null;
    let timeout: number | null = null;
    let opened = 0;
    let lastStart: number | null = null;
    let stopped = false;

    const tick = () => {
      if (!info) return;
      const t = this.o.now();
      l.onMessage(t, this.o.realNow());
      l.onPrice({ price: snapToTick(demoPrice(info.seed, info.base, t), info.tickSize), time: t, source: 'trade' });
      const start = barStart(tf, t);
      if (lastStart !== null && start > lastStart) {
        l.onCandle(demoCandleAt(info.seed, info.base, tf, lastStart, t, info.tickSize));
      }
      l.onCandle(demoCandleAt(info.seed, info.base, tf, start, t, info.tickSize));
      lastStart = start;
    };

    const open = () => {
      if (stopped) return;
      opened++;
      l.onSocketState('open');
      if (opened > 1) l.onReconnected();
      tick();
      interval = s.setInterval(tick, this.o.tickMs ?? 250);
    };

    const connect = () => {
      l.onSocketState('connecting');
      timeout = s.setTimeout(open, CONNECT_DELAY_MS);
    };

    const clear = () => {
      if (interval !== null) s.clearInterval(interval);
      if (timeout !== null) s.clearTimeout(timeout);
      interval = null;
      timeout = null;
    };

    connect();

    this.disconnectActive = (ms: number) => {
      if (stopped) return;
      clear();
      l.onSocketState('reconnecting');
      timeout = s.setTimeout(connect, ms);
    };

    const stop = () => {
      stopped = true;
      clear();
      if (this.stopActive === stop) {
        this.stopActive = null;
        this.disconnectActive = null;
      }
    };
    this.stopActive = stop;
    return stop;
  }

  simulateDisconnect(ms: number): void {
    this.disconnectActive?.(ms);
  }
}
