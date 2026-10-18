import { describe, expect, it } from 'vitest';
import { ReconnectingSocket, type SocketState } from '../../src/data/bybit/socket';
import { FakeScheduler, socketFactory } from './helpers/fakes';

function setup(over: Partial<{ backoffMaxMs: number; staleTimeoutMs: number }> = {}) {
  const scheduler = new FakeScheduler();
  const f = socketFactory();
  const states: SocketState[] = [];
  const messages: string[] = [];
  const rs = new ReconnectingSocket({
    url: 'wss://example/v5/public/linear',
    createSocket: f.create,
    scheduler,
    pingIntervalMs: 10_000,
    backoffBaseMs: 1_000,
    backoffMaxMs: over.backoffMaxMs ?? 30_000,
    staleTimeoutMs: over.staleTimeoutMs ?? 30_000,
  });
  rs.onStateChange((s) => states.push(s));
  rs.onMessage((m) => messages.push(m));
  return { scheduler, f, rs, states, messages };
}

describe('ReconnectingSocket', () => {
  it('subscribes topics on open', () => {
    const { f, rs } = setup();
    rs.setTopics(['kline.15.BTCUSDT', 'publicTrade.BTCUSDT']);
    rs.connect();
    f.latest().open();
    expect(f.latest().sentOps('subscribe')).toEqual([{ op: 'subscribe', args: ['kline.15.BTCUSDT', 'publicTrade.BTCUSDT'] }]);
  });

  it('pings every interval', () => {
    const { f, rs, scheduler } = setup();
    rs.connect();
    f.latest().open();
    scheduler.advance(10_000);
    expect(f.latest().sentOps('ping')).toHaveLength(1);
    f.latest().receive({ op: 'ping', ret_msg: 'pong', success: true });
    scheduler.advance(10_000);
    expect(f.latest().sentOps('ping')).toHaveLength(2);
  });

  it('forwards raw messages', () => {
    const { f, rs, messages } = setup();
    rs.connect();
    f.latest().open();
    f.latest().receive('{"topic":"x"}');
    expect(messages).toEqual(['{"topic":"x"}']);
  });

  it('reconnects with 1s then 2s backoff', () => {
    const { f, rs, scheduler, states } = setup();
    rs.connect();
    f.latest().open();
    f.latest().serverClose();
    expect(states[states.length - 1]).toBe('reconnecting');
    scheduler.advance(999);
    expect(f.sockets).toHaveLength(1);
    scheduler.advance(1);
    expect(f.sockets).toHaveLength(2);
    f.latest().serverClose(); // 열리기 전에 실패
    scheduler.advance(1_999);
    expect(f.sockets).toHaveLength(2);
    scheduler.advance(1);
    expect(f.sockets).toHaveLength(3);
  });

  it('backoff capped at max', () => {
    const { f, rs, scheduler } = setup({ backoffMaxMs: 4_000 });
    rs.connect();
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = f.sockets.length;
      f.latest().serverClose();
      let waited = 0;
      while (f.sockets.length === before) {
        scheduler.advance(500);
        waited += 500;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 4_000]);
  });

  it('backoff resets after open', () => {
    const { f, rs, scheduler } = setup();
    rs.connect();
    f.latest().serverClose();
    scheduler.advance(1_000);
    f.latest().serverClose();
    scheduler.advance(2_000);
    f.latest().open();
    f.latest().serverClose();
    scheduler.advance(1_000);
    expect(f.sockets).toHaveLength(4);
  });

  it('resubscribes after reconnect', () => {
    const { f, rs, scheduler } = setup();
    rs.setTopics(['tickers.BTCUSDT']);
    rs.connect();
    f.latest().open();
    f.latest().serverClose();
    scheduler.advance(1_000);
    f.latest().open();
    expect(f.latest().sentOps('subscribe')).toEqual([{ op: 'subscribe', args: ['tickers.BTCUSDT'] }]);
  });

  it('setTopics sends unsubscribe and subscribe diff', () => {
    const { f, rs } = setup();
    rs.setTopics(['a', 'b']);
    rs.connect();
    f.latest().open();
    rs.setTopics(['b', 'c']);
    expect(f.latest().sentOps('unsubscribe')).toEqual([{ op: 'unsubscribe', args: ['a'] }]);
    expect(f.latest().sentOps('subscribe')).toEqual([
      { op: 'subscribe', args: ['a', 'b'] },
      { op: 'subscribe', args: ['c'] },
    ]);
  });

  it('close stops reconnecting', () => {
    const { f, rs, scheduler, states } = setup();
    rs.connect();
    f.latest().open();
    rs.close();
    expect(states[states.length - 1]).toBe('closed');
    scheduler.advance(60_000);
    expect(f.sockets).toHaveLength(1);
    expect(f.latest().clientClosed).toBe(true);
  });

  it('reconnects when the server goes silent', () => {
    const { f, rs, scheduler } = setup({ staleTimeoutMs: 30_000 });
    rs.connect();
    f.latest().open();
    scheduler.advance(20_000);
    f.latest().receive('{"topic":"x"}');
    scheduler.advance(29_000);
    expect(f.sockets).toHaveLength(1);
    scheduler.advance(1_001);
    expect(f.sockets[0].clientClosed).toBe(true);
    scheduler.advance(1_000);
    expect(f.sockets).toHaveLength(2);
  });

  it('reports state transitions', () => {
    const { f, rs, scheduler, states } = setup();
    rs.connect();
    f.latest().open();
    f.latest().serverClose();
    scheduler.advance(1_000);
    f.latest().open();
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'connecting', 'open']);
  });
});
