import { describe, expect, it } from 'vitest';
import { atrSeries } from '../../src/core/atr';
import { snapToTick } from '../../src/core/price';
import { tfMs } from '../../src/core/timeframe';
import type { PriceTick } from '../../src/core/types';
import { demoCandles, DEMO_SYMBOLS } from '../../src/data/demo/generator';
import { DemoProvider } from '../../src/data/demo/provider';
import type { SocketState } from '../../src/data/bybit/socket';
import { FakeScheduler } from './helpers/fakes';

const T0 = Date.UTC(2026, 9, 18, 6, 7, 30);

describe('demoCandles', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    expect(demoCandles(1, '15', T0, 50, 0.1)).toEqual(demoCandles(1, '15', T0, 50, 0.1));
    expect(demoCandles(2, '15', T0, 50, 0.1)).not.toEqual(demoCandles(1, '15', T0, 50, 0.1));
  });

  it('produces sane OHLC on the tick grid', () => {
    for (const c of demoCandles(1, '5', T0, 300, 0.1)) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(snapToTick(c.high, 0.1)).toBe(c.high);
      expect(snapToTick(c.low, 0.1)).toBe(c.low);
    }
  });

  it('spaces candles by the timeframe and leaves only the live candle unconfirmed', () => {
    const list = demoCandles(1, '15', T0, 20, 0.1);
    expect(list).toHaveLength(20);
    for (let i = 1; i < list.length; i++) expect(list[i].time - list[i - 1].time).toBe(tfMs('15'));
    expect(list[list.length - 1].time).toBeLessThanOrEqual(T0);
    expect(list[list.length - 1].time + tfMs('15')).toBeGreaterThan(T0);
    expect(list.slice(0, -1).every((c) => c.confirmed)).toBe(true);
    expect(list[list.length - 1].confirmed).toBe(false);
  });

  it('contains sharp candles for the SL rule to find', () => {
    const list = demoCandles(1, '1', T0, 1000, 0.1);
    const atr = atrSeries(list, 14, 'wilder');
    let best = 0;
    for (let i = 15; i < list.length; i++) best = Math.max(best, (list[i].high - list[i].low) / (atr[i - 1] as number));
    expect(best).toBeGreaterThan(2);
  });

  it('lists demo symbols with a DEMO- prefix', () => {
    expect(DEMO_SYMBOLS.every((s) => s.symbol.startsWith('DEMO-'))).toBe(true);
  });
});

describe('DemoProvider', () => {
  function setup() {
    const scheduler = new FakeScheduler();
    const p = new DemoProvider({ now: () => T0 + scheduler.time, realNow: () => 5_000 + scheduler.time, scheduler, tickMs: 250 });
    const prices: PriceTick[] = [];
    const states: SocketState[] = [];
    const messages: [number | null, number][] = [];
    let reconnected = 0;
    const stop = p.watch('DEMO-BTC', '1', {
      onPrice: (t) => prices.push(t),
      onCandle: () => {},
      onSocketState: (s) => states.push(s),
      onMessage: (ts, at) => messages.push([ts, at]),
      onReconnected: () => reconnected++,
    });
    return { p, scheduler, prices, states, messages, stop, reconnected: () => reconnected };
  }

  it('is marked as demo', () => {
    expect(setup().p.isDemo).toBe(true);
  });

  it('watch emits prices on schedule after connecting', () => {
    const s = setup();
    s.scheduler.advance(300);
    expect(s.states).toEqual(['connecting', 'open']);
    expect(s.prices.length).toBe(1); // 연결 직후 스냅샷 1회
    s.scheduler.advance(1_000);
    expect(s.prices.length).toBe(5);
    expect(s.prices[0].source).toBe('trade');
    expect(s.messages[0][1]).toBeGreaterThanOrEqual(5_000);
  });

  it('simulateDisconnect drops the feed and then reconnects', () => {
    const s = setup();
    s.scheduler.advance(300);
    s.p.simulateDisconnect(5_000);
    expect(s.states[s.states.length - 1]).toBe('reconnecting');
    const before = s.prices.length;
    s.scheduler.advance(4_000);
    expect(s.prices.length).toBe(before);
    s.scheduler.advance(1_400);
    expect(s.states.slice(-2)).toEqual(['connecting', 'open']);
    expect(s.reconnected()).toBe(1);
    expect(s.prices.length).toBeGreaterThan(before);
  });

  it('stop ends the feed', () => {
    const s = setup();
    s.scheduler.advance(300);
    s.stop();
    const n = s.prices.length;
    s.scheduler.advance(2_000);
    expect(s.prices.length).toBe(n);
  });
});
