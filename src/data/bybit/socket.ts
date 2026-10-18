/** 브라우저 WebSocket 중 이 모듈이 쓰는 부분 (테스트에서 가짜로 바꿔 끼운다) */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export type SocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ReconnectingSocketOptions {
  url: string;
  createSocket: (url: string) => WebSocketLike;
  scheduler: Scheduler;
  /** Bybit 권장 20초. 이 앱은 끊김을 빨리 알아채려고 10초를 쓴다. */
  pingIntervalMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** 열린 상태에서 이 시간 동안 아무 메시지도 없으면 연결이 죽은 것으로 보고 다시 연결한다. */
  staleTimeoutMs: number;
}

const OPEN = 1;
let reqSeq = 0;

/**
 * 구독 주제를 기억하는 웹소켓.
 * 끊기면 지수 백오프(1s, 2s, 4s … 최대값)로 다시 연결하고, 다시 열리면 같은 주제를 재구독한다.
 */
export class ReconnectingSocket {
  private ws: WebSocketLike | null = null;
  private topics: string[] = [];
  private attempts = 0;
  private userClosed = false;
  private pingTimer: number | null = null;
  private watchdog: number | null = null;
  private reconnectTimer: number | null = null;
  private state: SocketState = 'idle';
  private messageCbs: ((data: string) => void)[] = [];
  private stateCbs: ((s: SocketState) => void)[] = [];

  constructor(private readonly o: ReconnectingSocketOptions) {}

  onMessage(cb: (data: string) => void): void {
    this.messageCbs.push(cb);
  }

  onStateChange(cb: (s: SocketState) => void): void {
    this.stateCbs.push(cb);
  }

  getState(): SocketState {
    return this.state;
  }

  connect(): void {
    this.userClosed = false;
    this.open();
  }

  close(): void {
    this.userClosed = true;
    this.clearTimers();
    if (this.reconnectTimer !== null) this.o.scheduler.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      detach(ws);
      try {
        ws.close();
      } catch {
        // 이미 닫힘
      }
    }
    this.setState('closed');
  }

  setTopics(next: string[]): void {
    const removed = this.topics.filter((t) => !next.includes(t));
    const added = next.filter((t) => !this.topics.includes(t));
    this.topics = [...next];
    if (this.ws && this.ws.readyState === OPEN) {
      if (removed.length) this.send({ op: 'unsubscribe', args: removed });
      if (added.length) this.send({ op: 'subscribe', args: added });
    }
  }

  /** 테스트·디버그용: 연결이 비정상 종료된 것처럼 처리 */
  dropConnection(): void {
    this.drop();
  }

  private open(): void {
    this.setState('connecting');
    const ws = this.o.createSocket(this.o.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempts = 0;
      this.setState('open');
      if (this.topics.length) this.send({ op: 'subscribe', args: this.topics });
      this.pingTimer = this.o.scheduler.setInterval(() => this.send({ op: 'ping' }), this.o.pingIntervalMs);
      this.armWatchdog();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.armWatchdog();
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      for (const cb of this.messageCbs) cb(data);
    };
    ws.onerror = () => {
      // 브라우저는 error 뒤에 close를 보낸다. 재연결은 onclose에서 처리.
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.handleClosed();
    };
  }

  /** 응답 없는 연결을 버리고 곧바로 재연결 절차에 들어간다 (close 이벤트를 기다리지 않음) */
  private drop(): void {
    const ws = this.ws;
    if (!ws) return;
    detach(ws);
    try {
      ws.close();
    } catch {
      // 무시
    }
    this.handleClosed();
  }

  private handleClosed(): void {
    this.clearTimers();
    this.ws = null;
    if (this.userClosed) {
      this.setState('closed');
      return;
    }
    this.setState('reconnecting');
    const delay = Math.min(this.o.backoffMaxMs, this.o.backoffBaseMs * 2 ** this.attempts);
    this.attempts++;
    this.reconnectTimer = this.o.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.userClosed) this.open();
    }, delay);
  }

  private armWatchdog(): void {
    if (this.watchdog !== null) this.o.scheduler.clearTimeout(this.watchdog);
    this.watchdog = this.o.scheduler.setTimeout(() => {
      this.watchdog = null;
      this.drop();
    }, this.o.staleTimeoutMs);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) this.o.scheduler.clearInterval(this.pingTimer);
    if (this.watchdog !== null) this.o.scheduler.clearTimeout(this.watchdog);
    this.pingTimer = null;
    this.watchdog = null;
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== OPEN) return;
    this.ws.send(JSON.stringify({ req_id: String(++reqSeq), ...msg }));
  }

  private setState(s: SocketState): void {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateCbs) cb(s);
  }
}

function detach(ws: WebSocketLike): void {
  ws.onopen = null;
  ws.onclose = null;
  ws.onerror = null;
  ws.onmessage = null;
}
