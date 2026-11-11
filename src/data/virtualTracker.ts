import { JOURNAL_KEY, parseJournal, type Trade } from '../core/journal';
import type { StorageLike } from '../core/persistence';
import { MIN, resolveByCandles, trackStart, type AutoClose } from '../core/virtualTrack';
import { fetchKlineRange, type FetchLike } from './bybit/klineRange';

export interface TrackerDeps {
  storage: StorageLike;
  fetchImpl: FetchLike;
  bases: readonly string[];
  now: () => number;
}

/** 한 차례에 거래당 받는 쪽 수 (1쪽 = 1000분). 더 밀렸으면 다음 차례에 이어서 */
const MAX_PAGES = 5;
/** 한 차례에 따라갈 거래 수 (통신 수 한도) */
const MAX_TRADES = 20;

const load = (storage: StorageLike) => {
  try {
    return parseJournal(storage.getItem(JOURNAL_KEY));
  } catch {
    return parseJournal(null);
  }
};

/**
 * 열린 거래를 1분 캔들로 따라가 손절·목표에 닿은 것을 자동 청산한다. 청산된 거래를 돌려준다.
 * 통신 실패는 그 거래만 건너뛴다(다음 차례에 다시). 저장 직전에 저널을 다시 읽어,
 * 받는 사이 사용자가 직접 청산하거나 지운 거래는 건드리지 않는다.
 */
export async function trackOpenTrades(d: TrackerDeps): Promise<Trade[]> {
  const open = load(d.storage).trades.filter((t) => t.exit === null).slice(0, MAX_TRADES);
  const results = new Map<string, { close: AutoClose | null; trackedTo: number }>();
  for (const t of open) {
    const now = d.now();
    const from = trackStart(t);
    if (from + MIN > now) continue;
    try {
      const candles = await fetchKlineRange(d.fetchImpl, d.bases, t.symbol, from, now, MAX_PAGES);
      if (!candles.length) continue;
      results.set(t.id, { close: resolveByCandles(t, candles), trackedTo: candles[candles.length - 1].time + MIN });
    } catch {
      // 다음 차례에 다시
    }
  }
  if (!results.size) return [];
  const fresh = load(d.storage);
  const closed: Trade[] = [];
  let changed = false;
  for (const t of fresh.trades) {
    const r = results.get(t.id);
    if (!r || t.exit !== null) continue;
    if (r.close) {
      t.exit = r.close.exit;
      t.closedAt = r.close.closedAt;
      t.auto = r.close.hit;
      delete t.trackedTo;
      closed.push(t);
    } else t.trackedTo = r.trackedTo;
    changed = true;
  }
  if (changed) {
    try {
      d.storage.setItem(JOURNAL_KEY, JSON.stringify(fresh));
    } catch {
      return [];
    }
  }
  return closed;
}
