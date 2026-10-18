import type { PriceTick } from './types';

export interface FeedSnapshot {
  socketOpen: boolean;
  /** 마지막으로 어떤 메시지든(퐁 포함) 받은 브라우저 시각 */
  lastMessageAt: number | null;
  /** 거래소 시각이 붙은 마지막 메시지: 거래소 시각과 받은 브라우저 시각 */
  clock: { serverTs: number; receivedAt: number } | null;
  lastPrice: PriceTick | null;
}

export interface FreshnessOptions {
  staleAfterMs: number;
  maxPriceAgeMs: number;
}

export type FeedStatus = 'connecting' | 'live' | 'stale' | 'disconnected';

export interface Freshness {
  status: FeedStatus;
  canCreate: boolean;
  reason: string | null;
  /** 거래소 현재 시각 추정치 − 최신 가격 시각 */
  priceAgeMs: number | null;
}

const sec = (ms: number) => Math.round(ms / 1000);

/**
 * 연결·가격 신선도 판정 (설계 문서 D4).
 * 가격 나이는 브라우저 시계와 거래소 시계를 섞지 않도록
 * '마지막 거래소 시각 + 그 뒤 흐른 브라우저 시간'으로 거래소 현재 시각을 추정해 계산한다.
 */
export function evaluateFreshness(f: FeedSnapshot, now: number, o: FreshnessOptions): Freshness {
  if (!f.socketOpen) {
    return { status: 'disconnected', canCreate: false, reason: '데이터 연결 끊김', priceAgeMs: null };
  }
  if (f.lastMessageAt === null) {
    return { status: 'connecting', canCreate: false, reason: '데이터 수신 대기 중', priceAgeMs: null };
  }
  const silence = now - f.lastMessageAt;
  if (silence > o.staleAfterMs) {
    return {
      status: 'stale',
      canCreate: false,
      reason: `${sec(silence)}초간 데이터 없음 (기준 ${sec(o.staleAfterMs)}초)`,
      priceAgeMs: null,
    };
  }
  if (!f.lastPrice) {
    return { status: 'live', canCreate: false, reason: '아직 수신한 가격 없음', priceAgeMs: null };
  }
  if (!f.clock) {
    return { status: 'live', canCreate: false, reason: '가격 시각을 확인할 수 없음', priceAgeMs: null };
  }
  const serverNow = f.clock.serverTs + (now - f.clock.receivedAt);
  const priceAgeMs = Math.max(0, serverNow - f.lastPrice.time);
  if (priceAgeMs > o.maxPriceAgeMs) {
    return {
      status: 'live',
      canCreate: false,
      reason: `오래된 가격 (마지막 체결 ${sec(priceAgeMs)}초 전, 기준 ${sec(o.maxPriceAgeMs)}초)`,
      priceAgeMs,
    };
  }
  return { status: 'live', canCreate: true, reason: null, priceAgeMs };
}

export type EntryCapture =
  | { ok: true; price: number; priceTime: number; source: 'trade' | 'ticker'; clickedAt: number }
  | { ok: false; reason: string };

/** LONG/SHORT 클릭 순간 호출: 그 순간의 최신 수신 가격을 엔트리로 잡는다. */
export function captureEntry(f: FeedSnapshot, now: number, o: FreshnessOptions): EntryCapture {
  const fresh = evaluateFreshness(f, now, o);
  if (!fresh.canCreate || !f.lastPrice) return { ok: false, reason: fresh.reason ?? '가격 없음' };
  return { ok: true, price: f.lastPrice.price, priceTime: f.lastPrice.time, source: f.lastPrice.source, clickedAt: now };
}
