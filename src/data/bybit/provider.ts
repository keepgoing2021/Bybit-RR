import type { FlowBar } from '../../core/flow';
import type { Candle, SymbolInfo, TickerStat, Timeframe } from '../../core/types';
import type { FeedListener, MarketDataProvider } from '../provider';
import { parseInstruments, parseKlineList, parseTickers, parseWsMessage } from './parse';
import { ReconnectingSocket, type Scheduler, type WebSocketLike } from './socket';

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

export interface BybitProviderOptions {
  /** REST 주소 후보. 앞에서부터 시도하고, 처음 성공한 주소를 계속 쓴다. */
  restBases: string[];
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
/** 연결 하나의 구독 목록 글자 수 상한 (Bybit 21,000자보다 여유 있게) */
const FLOW_TOPIC_CHARS = 18_000;

/** Bybit V5 USDT 무기한 선물(category=linear) 퍼블릭 시세 */
export class BybitProvider implements MarketDataProvider {
  private active: ReconnectingSocket | null = null;
  private preferred = 0;

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

  async fetchTickers(): Promise<TickerStat[]> {
    const body = await this.getJson('/v5/market/tickers?category=linear');
    return parseTickers(((body.result as { list?: unknown[] } | undefined)?.list ?? []) as unknown[]);
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

  /**
   * 전 종목 1분봉(kline.1.*)을 차트와 다른 연결로 받는다.
   * Bybit 공개 연결 하나의 구독 목록은 21,000자 이하라 18,000자씩 나눠 연결을 여러 개 연다.
   */
  watchFlow(symbols: string[], onBar: (symbol: string, bar: FlowBar, receivedAt: number) => void): () => void {
    const chunks: string[][] = [];
    let cur: string[] = [];
    let len = 0;
    for (const s of symbols) {
      const t = `kline.1.${s}`;
      if (cur.length && len + t.length + 3 > FLOW_TOPIC_CHARS) {
        chunks.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(t);
      len += t.length + 3;
    }
    if (cur.length) chunks.push(cur);
    const sockets = chunks.map((topics) => {
      const socket = new ReconnectingSocket({
        url: this.o.wsUrl,
        createSocket: this.o.createSocket,
        scheduler: this.o.scheduler,
        pingIntervalMs: this.o.pingIntervalMs ?? 10_000,
        backoffBaseMs: this.o.backoffBaseMs ?? 1_000,
        backoffMaxMs: this.o.backoffMaxMs ?? 30_000,
        // 거래가 드문 종목만 모인 연결도 있으니 오래 조용해도 끊지 않는다 (퐁은 10초마다 온다)
        staleTimeoutMs: this.o.socketSilenceMs ?? 30_000,
      });
      socket.onMessage((raw) => {
        const receivedAt = this.o.now();
        const { event } = parseWsMessage(raw);
        if (event.type !== 'kline' || !event.topic.startsWith('kline.1.')) return;
        const symbol = event.topic.slice('kline.1.'.length);
        for (const c of event.candles) {
          onBar(symbol, { start: c.time, open: c.open, close: c.close, turnover: c.turnover ?? 0 }, receivedAt);
        }
      });
      socket.setTopics(topics);
      socket.connect();
      return socket;
    });
    return () => {
      for (const s of sockets) s.close();
    };
  }

  /**
   * 주소 후보를 차례로 시도한다. 연결 실패·HTTP 오류면 다음 후보로 넘어가고,
   * Bybit가 오류 코드로 답한 경우(요청 자체의 문제)는 다른 주소로 다시 시도하지 않는다.
   */
  private async getJson(path: string): Promise<Record<string, unknown>> {
    const bases = this.o.restBases;
    const order = [this.preferred, ...bases.map((_, i) => i).filter((i) => i !== this.preferred)];
    const errors: string[] = [];
    for (const i of order) {
      const base = bases[i];
      let body: Record<string, unknown>;
      try {
        const res = await this.o.fetchImpl(`${base}${path}`);
        if (!res.ok) {
          errors.push(`${base || '/'}: HTTP ${res.status} ${res.statusText}`.trim());
          continue;
        }
        body = (await res.json()) as Record<string, unknown>;
      } catch (e) {
        errors.push(`${base || '/'}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      this.preferred = i;
      if (body.retCode !== 0) throw new Error(`Bybit 오류 ${String(body.retCode)}: ${String(body.retMsg ?? '')}`);
      return body;
    }
    throw new Error(`Bybit REST 연결 실패 (${errors.join(' / ')})`);
  }
}
