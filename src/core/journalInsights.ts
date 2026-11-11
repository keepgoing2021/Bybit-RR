import { isRuleBreak, periodStart, sessionOf, tradeResult, type Journal, type Trade, type TradeResult } from './journal';

/**
 * 저널 첫 화면·통계에 쓰는 계산 (2026-11-11 개편). 화면 없는 순수 함수만 둔다.
 * 날짜·주 경계는 한국 시간 (journal.ts의 periodStart와 같음).
 * 결과를 계산할 수 없는 거래(열려 있음, 손절폭 0)는 어디서나 뺀다.
 */
const KST = 9 * 3600_000;
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

interface Row {
  t: Trade;
  res: TradeResult;
  at: number;
}

/** 끝난 거래를 청산 순서대로 */
function closedRows(trades: Trade[]): Row[] {
  const out: Row[] = [];
  for (const t of trades) {
    const res = tradeResult(t);
    if (res === null || t.closedAt === null || !Number.isFinite(res.r)) continue;
    out.push({ t, res, at: t.closedAt });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 한국 날짜 'YYYY-MM-DD' */
export function dayKey(ms: number): string {
  const d = new Date(ms + KST);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 날짜별 R 합계와 거래 수 (청산한 날 기준) */
export function dailyTotals(trades: Trade[]): Map<string, { r: number; n: number }> {
  const m = new Map<string, { r: number; n: number }>();
  for (const x of closedRows(trades)) {
    const k = dayKey(x.at);
    const cur = m.get(k) ?? { r: 0, n: 0 };
    m.set(k, { r: cur.r + x.res.r, n: cur.n + 1 });
  }
  return m;
}

/** 한 달 달력 칸 (일요일 시작). 1일 앞의 빈칸은 null */
export function monthCells(year: number, month0: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(d)}`);
  return cells;
}

/** 오늘까지 n일의 날짜 (오래된 날 → 오늘) */
export function lastDayKeys(now: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * DAY));
}

export interface Score {
  /** 0~100 (반올림) */
  total: number;
  profit: number;
  rules: number;
  loss: number;
  consistency: number;
}
export const SCORE_MIN_TRADES = 10;
const SCORE_DAYS = 30;
const hasChips = (t: Trade) => t.closeRule !== undefined && t.mood !== undefined;

/** 최근 30일 점수. 각 25점: 수익 · 규칙 준수 · 손실 관리 · 꾸준함. 거래 10개 미만이면 null */
export function score(trades: Trade[], now: number): Score | null {
  const rows = closedRows(trades).filter((x) => x.at > now - SCORE_DAYS * DAY && x.at <= now + DAY);
  const n = rows.length;
  if (n < SCORE_MIN_TRADES) return null;
  const avgR = rows.reduce((a, x) => a + x.res.r, 0) / n;
  const losses = rows.filter((x) => x.res.outcome === 'loss');
  const profit = 25 * Math.min(1, Math.max(0, avgR + 0.5));
  const rules = (25 * rows.filter((x) => !isRuleBreak(x.t)).length) / n;
  // 손절을 지켰으면 −1R 근처 (수수료·미끄러짐 여유 0.1R)
  const loss = losses.length ? (25 * losses.filter((x) => x.res.r >= -1.1).length) / losses.length : 25;
  const consistency = (25 * rows.filter((x) => hasChips(x.t)).length) / n;
  return { total: Math.round(profit + rules + loss + consistency), profit, rules, loss, consistency };
}

/** 연속 기록: 최근 거래일부터, 그날 끝난 거래 전부에 칩 두 줄이 채워진 날 수. 거래 없는 날은 끊지 않는다 */
export function recordStreak(trades: Trade[]): number {
  const byDay = new Map<string, boolean>();
  for (const x of closedRows(trades)) {
    const k = dayKey(x.at);
    byDay.set(k, (byDay.get(k) ?? true) && hasChips(x.t));
  }
  let n = 0;
  for (const k of [...byDay.keys()].sort().reverse()) {
    if (!byDay.get(k)) break;
    n++;
  }
  return n;
}

/** 가장 약한 곳: 「세션 · 방향」과 셋업 묶음 중 합계 R이 가장 낮은 마이너스 묶음 (거래 min개 이상) */
export function weakestSpot(trades: Trade[], min = 5): { label: string; r: number } | null {
  const sums = new Map<string, { r: number; n: number }>();
  const add = (label: string, r: number) => {
    const cur = sums.get(label) ?? { r: 0, n: 0 };
    sums.set(label, { r: cur.r + r, n: cur.n + 1 });
  };
  for (const x of closedRows(trades)) {
    add(`${sessionOf(x.t.openedAt)} · ${x.t.side === 'LONG' ? '롱' : '숏'}`, x.res.r);
    if (x.t.setup) add(`셋업: ${x.t.setup}`, x.res.r);
  }
  let worst: { label: string; r: number } | null = null;
  for (const [label, v] of sums) {
    if (v.n < min || !(v.r < 0)) continue;
    if (worst === null || v.r < worst.r) worst = { label, r: v.r };
  }
  return worst;
}

/** 청산 순서대로 쌓은 누적 R */
export function cumulativeR(trades: Trade[]): number[] {
  let sum = 0;
  return closedRows(trades).map((x) => (sum += x.res.r));
}

/** 최대 낙폭 (R, 양수). 고점에서 가장 많이 내려온 폭 */
export function maxDrawdownR(trades: Trade[]): number {
  let peak = 0;
  let dd = 0;
  for (const v of cumulativeR(trades)) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak - v);
  }
  return dd;
}

/** 최대 연속 승 · 연속 패 (본전은 둘 다 끊는다) */
export function maxStreaks(trades: Trade[]): { win: number; loss: number } {
  let win = 0;
  let loss = 0;
  let w = 0;
  let l = 0;
  for (const x of closedRows(trades)) {
    w = x.res.outcome === 'win' ? w + 1 : 0;
    l = x.res.outcome === 'loss' ? l + 1 : 0;
    win = Math.max(win, w);
    loss = Math.max(loss, l);
  }
  return { win, loss };
}

/** 평균 보유 시간 (ms) */
export function avgHoldMs(trades: Trade[]): number | null {
  const holds = closedRows(trades).map((x) => x.at - x.t.openedAt).filter((v) => v >= 0);
  return holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null;
}

export interface MonthRow {
  /** 'YYYY-MM' */
  key: string;
  trades: number;
  winRate: number | null;
  totalR: number;
}

const summarize = (rows: Row[]) => {
  const wins = rows.filter((x) => x.res.outcome === 'win').length;
  const losses = rows.filter((x) => x.res.outcome === 'loss').length;
  return { trades: rows.length, winRate: wins + losses ? wins / (wins + losses) : null, totalR: rows.reduce((a, x) => a + x.res.r, 0) };
};

/** 월별 표 (최근 달 먼저) */
export function monthlyRows(trades: Trade[]): MonthRow[] {
  const by = new Map<string, Row[]>();
  for (const x of closedRows(trades)) {
    const k = dayKey(x.at).slice(0, 7);
    by.set(k, [...(by.get(k) ?? []), x]);
  }
  return [...by.keys()].sort().reverse().map((key) => ({ key, ...summarize(by.get(key)!) }));
}

export interface WeekSummary {
  trades: number;
  winRate: number | null;
  totalR: number;
  /** 규칙을 지킨 거래 수 */
  kept: number;
}

/** weekStart(월요일 00:00 한국 시간)부터 7일 동안 끝난 거래 요약 */
export function weekSummary(trades: Trade[], weekStart: number): WeekSummary {
  const rows = closedRows(trades).filter((x) => x.at >= weekStart && x.at < weekStart + 7 * DAY);
  return { ...summarize(rows), kept: rows.filter((x) => !isRuleBreak(x.t)).length };
}

const lastWeekStart = (now: number) => periodStart(now, 'week') - 7 * DAY;

/** 아직 리뷰를 안 쓴 지난 주의 시작 시각. 지난 주에 끝난 거래가 없거나 이미 썼으면 null */
export function pendingReviewWeek(j: Journal, now: number): number | null {
  const start = lastWeekStart(now);
  if ((j.reviews ?? []).some((r) => r.weekStart === start)) return null;
  return weekSummary(j.trades, start).trades > 0 ? start : null;
}

/** 이번 주 고칠 것 (지난 주 리뷰에 적은 것). 없으면 null */
export function currentFix(j: Journal, now: number): string | null {
  const start = lastWeekStart(now);
  const fix = (j.reviews ?? []).find((r) => r.weekStart === start)?.fix.trim();
  return fix ? fix : null;
}
