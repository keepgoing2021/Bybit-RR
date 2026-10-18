import { describe, expect, it } from 'vitest';
import { captureEntry, evaluateFreshness, type FeedSnapshot } from '../../src/core/freshness';

const opts = { staleAfterMs: 15_000, maxPriceAgeMs: 60_000 };

const live = (over: Partial<FeedSnapshot> = {}): FeedSnapshot => ({
  socketOpen: true,
  lastMessageAt: 5_000,
  clock: { serverTs: 1_000, receivedAt: 5_000 },
  lastPrice: { price: 100.5, time: 1_500, source: 'trade' },
  ...over,
});

describe('evaluateFreshness', () => {
  it('closed socket is disconnected and blocks creation', () => {
    const r = evaluateFreshness(live({ socketOpen: false }), 6_000, opts);
    expect(r.status).toBe('disconnected');
    expect(r.canCreate).toBe(false);
    expect(r.reason).toContain('끊김');
  });

  it('open socket without any message is connecting', () => {
    const r = evaluateFreshness(live({ lastMessageAt: null, clock: null, lastPrice: null }), 6_000, opts);
    expect(r.status).toBe('connecting');
    expect(r.canCreate).toBe(false);
  });

  it('no message for longer than staleAfter is stale', () => {
    const r = evaluateFreshness(live(), 5_000 + 15_001, opts);
    expect(r.status).toBe('stale');
    expect(r.canCreate).toBe(false);
    expect(r.reason).toContain('15초');
  });

  it('estimates price age from exchange time plus local elapsed time', () => {
    const r = evaluateFreshness(live(), 6_000, opts);
    expect(r.status).toBe('live');
    expect(r.priceAgeMs).toBe(500);
    expect(r.canCreate).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('price older than the limit blocks creation', () => {
    const r = evaluateFreshness(live({ lastPrice: { price: 100, time: -60_000, source: 'trade' } }), 6_000, opts);
    expect(r.status).toBe('live');
    expect(r.canCreate).toBe(false);
    expect(r.reason).toContain('오래된');
  });

  it('live without a price yet cannot create', () => {
    const r = evaluateFreshness(live({ lastPrice: null }), 6_000, opts);
    expect(r.canCreate).toBe(false);
    expect(r.reason).toContain('가격');
  });
});

describe('captureEntry', () => {
  it('returns the latest price with its exchange time and the click time', () => {
    const r = captureEntry(live(), 6_000, opts);
    expect(r).toEqual({ ok: true, price: 100.5, priceTime: 1_500, source: 'trade', clickedAt: 6_000 });
  });

  it('refuses when the feed is not fresh', () => {
    const r = captureEntry(live({ socketOpen: false }), 6_000, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('끊김');
  });
});
