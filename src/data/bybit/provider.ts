import type { Candle, SymbolInfo, Timeframe } from '../../core/types';
import type { FeedListener, MarketDataProvider } from '../provider';
import { parseInstruments, parseKlineList, parseWsMessage } from './parse';
import { ReconnectingSocket, type Scheduler, type WebSocketLike } from './socket';

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

export interface BybitProviderOptions {
  restBase: string;
  wsUrl: string;
  fetchImpl: FetchLike;
  createSocket: (url: string) => WebSocketLike;
  scheduler: Scheduler;
  /** 브라우저 시계 */
  now: () => number;
  pingIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  socketSilenceMs?: number;
}

const PINNED = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

/** Bybit V5 USDT 무기한 선물(category=linear) 퍼블릭 시세 */
export class BybitProvider implements MarketDataProvider {
  readonly kind = 'bybit' as const;
  readonly isDemo = false;
  private active: ReconnectingSocket | null = null;

  constructor(private readonly o: BybitProviderOptions) {}

  async listSymbols(): Promise<SymbolInfo[]> {
    const out: SymbolInfo[] = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const body = await this.getJson(`/v5/market/instruments-info?category=linear&limit=1000${q}`);
      const result = body.result as { list?: unknown[]; nextPageCursor?: string } | undefined;
      out.push(...parseInstruments(result?.list ?? []));
      cursor = result?.nextPageCursor ?? '';
      if (!cursor) break;
    }
    const rank = (s: string) => {
      const i = PINNED.indexOf(s);
      return i === -1 ? PINNED.length : i;
    };
    return out.sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol));
  }

  async fetchCandles(symbol: string, tf: Timeframe, limit: number): Promise<{ candles: Candle[]; serverTime: number }> {
    const body = await this.getJson(
      `/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${tf}&limit=${limit}`,
    );
    const serverTime = typeof body.time === 'number' ? body.time : this.o.now();
    const list = ((body.result as { list?: string[][] } | undefined)?.list ?? []) as string[][];
    return { candles: parseKlineList(list, serverTime, tf), serverTime };
  }

  watch(symbol: string, tf: Timeframe, l: FeedListener): () => void {
    this.active?.close();
    const socket = new ReconnectingSocket({
      url: this.o.wsUrl,
      createSocket: this.o.createSocket,
      scheduler: this.o.scheduler,
      pingIntervalMs: this.o.pingIntervalMs ?? 10_000,
      backoffBaseMs: this.o.backoffBaseMs ?? 1_000,
      backoffMaxMs: this.o.backoffMaxMs ?? 30_000,
      staleTimeoutMs: this.o.socketSilenceMs ?? 30_000,
    });
    const klineTopic = `kline.${tf}.${symbol}`;
    const tradeTopic = `publicTrade.${symbol}`;
    const tickerTopic = `tickers.${symbol}`;
    let gotTrade = false;
    let opens = 0;

    socket.onStateChange((s) => {
      l.onSocketState(s);
      if (s === 'open') {
        opens++;
        if (opens > 1) l.onReconnected();
      }
    });

    socket.onMessage((raw) => {
      const receivedAt = this.o.now();
      const { event, ts } = parseWsMessage(raw);
      l.onMessage(ts, receivedAt);
      if (event.type === 'trade' && event.topic === tradeTopic && event.ticks.length) {
        gotTrade = true;
        l.onPrice(event.ticks[event.ticks.length - 1]);
      } else if (event.type === 'kline' && event.topic === klineTopic) {
        for (const c of event.candles) l.onCandle(c);
      } else if (event.type === 'ticker' && event.topic === tickerTopic && !gotTrade && event.lastPrice !== null) {
        l.onPrice({ price: event.lastPrice, time: event.ts, source: 'ticker' });
      }
    });

    socket.setTopics([klineTopic, tradeTopic, tickerTopic]);
    socket.connect();
    this.active = socket;

    return () => {
      socket.close();
      if (this.active === socket) this.active = null;
    };
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const res = await this.o.fetchImpl(`${this.o.restBase}${path}`);
    if (!res.ok) throw new Error(`Bybit REST 응답 ${res.status} ${res.statusText}`.trim());
    const body = (await res.json()) as Record<string, unknown>;
    if (body.retCode !== 0) throw new Error(`Bybit 오류 ${String(body.retCode)}: ${String(body.retMsg ?? '')}`);
    return body;
  }
}
