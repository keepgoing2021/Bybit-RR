import type { Scheduler, WebSocketLike } from '../../../src/data/bybit/socket';

interface Timer { id: number; at: number; fn: () => void; every: number | null }

/** 가상 시간 스케줄러. advance(ms)로 시간을 흘려 타이머를 실행한다. */
export class FakeScheduler implements Scheduler {
  time = 0;
  private timers: Timer[] = [];
  private nextId = 1;

  now = (): number => this.time;

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + ms, fn, every: null });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };

  setInterval = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + ms, fn, every: ms });
    return id;
  };

  clearInterval = (id: number): void => this.clearTimeout(id);

  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.time = due.at;
      if (due.every === null) this.timers = this.timers.filter((t) => t !== due);
      else due.at += due.every;
      due.fn();
    }
    this.time = end;
  }
}

export class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: unknown[] = [];
  clientClosed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(public url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    if (this.readyState === 3) return;
    this.clientClosed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  // 서버 쪽 동작
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  serverClose(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  /** op가 같은 보낸 메시지들 (req_id 제외) */
  sentOps(op: string): unknown[] {
    return this.sent
      .filter((m) => (m as { op: string }).op === op)
      .map((m) => {
        const { req_id: _ignored, ...rest } = m as Record<string, unknown>;
        return rest;
      });
  }
}

export function socketFactory() {
  const sockets: FakeSocket[] = [];
  const create = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return { sockets, create, latest: () => sockets[sockets.length - 1] };
}
