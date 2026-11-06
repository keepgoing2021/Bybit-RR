import type { Side } from './types';

/**
 * 거래 저널 (2026-11-06). 계산기의 「기록」 버튼으로 시작하고 1rc.app/journal에서 돌아본다.
 * 참고: 사용자가 보내 준 스프레드시트 저널(7칸 입력 → 순손익·R·규칙 경고 자동, RCR, 리스크 자동 조절, 하루 운영 규칙).
 * 1RC는 종목·방향·진입·손절·수량·리스크를 이미 알아서, 사용자는 셋업·품질·근거 한 줄과 청산가만 넣는다.
 * 저장은 이 브라우저에만 (서버 없음).
 */

/** 진입 품질: 규칙 준수 / 고확률 / 규칙 위반 */
export type Quality = 'rule' | 'high' | 'break';
export const QUALITY_LABEL: Record<Quality, string> = { rule: '규칙 준수', high: '고확률', break: '규칙 위반' };

export interface Trade {
  id: string;
  symbol: string;
  side: Side;
  entry: number;
  sl: number;
  tp: number | null;
  /** 전체 수량 (분할 전부 체결 기준). 운영자산을 안 넣었으면 null */
  qty: number | null;
  /** 손절 시 손실 (USDT, 계산기 기준) */
  riskUsdt: number | null;
  /** 손절 시 손실이 총 자산의 몇 % */
  riskPct: number | null;
  openedAt: number;
  closedAt: number | null;
  exit: number | null;
  setup: string;
  quality: Quality;
  /** 근거 한 줄 */
  reason: string;
  /** 진입할 때 체크한 내 규칙 (규칙 문구) */
  rules: string[];
  /** 한쪽 수수료율 (시장가). 순손익 = 가격 차 − 진입·청산 수수료 */
  feeRate: number;
}

export interface DailyRules {
  /** 하루 최대 거래 수 (0 = 끔) */
  maxTradesPerDay: number;
  /** 연속 손절 N번이면 그날 중단 (0 = 끔) */
  stopAfterLosses: number;
}

/** 손실 한도 (R 단위, 양수로 적음. 예: 하루 3 = 하루 −3R까지) */
export interface LossLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

/** 리스크 자동 조절: 누적 수익률이 기준 이상이면 위험을 키우고, 내려가면 평소로 */
export interface AutoRisk {
  enabled: boolean;
  basePct: number;
  upPct: number;
  /** 총 자산 대비 누적 순손익 % 기준 */
  thresholdPct: number;
}

export interface JournalSettings {
  setups: string[];
  /** 나의 진입 규칙 (최대 8개) */
  rules: string[];
  daily: DailyRules;
  limits: LossLimits;
  autoRisk: AutoRisk;
}

export interface Journal {
  version: 1;
  trades: Trade[];
  settings: JournalSettings;
}

export const MAX_RULES = 8;
export const MIN_GROUP_TRADES = 10;

export const DEFAULT_JOURNAL_SETTINGS: JournalSettings = {
  setups: ['추세전환 눌림', '추세 지속 돌파', '스윕 반전', '지지·저항 반등'],
  rules: ['큰 추세 방향과 같다', '핵심 자리에 닿았다', '확인 신호가 나왔다', '계획한 위험 이하', '감정이 평정하다', '경제지표 일정을 확인했다'],
  daily: { maxTradesPerDay: 5, stopAfterLosses: 3 },
  limits: { daily: 3, weekly: 6, monthly: 10 },
  autoRisk: { enabled: false, basePct: 0.5, upPct: 1, thresholdPct: 2 },
};

export function emptyJournal(): Journal {
  return { version: 1, trades: [], settings: structuredClone(DEFAULT_JOURNAL_SETTINGS) };
}

// ---------- 계산 ----------

const dirOf = (side: Side) => (side === 'LONG' ? 1 : -1);

/** 가격 기준 R (수수료 전): 손절폭 대비 몇 배 움직였나 */
export function grossR(t: Pick<Trade, 'side' | 'entry' | 'sl'>, exit: number): number | null {
  const risk = Math.abs(t.entry - t.sl);
  if (!(risk > 0)) return null;
  return (dirOf(t.side) * (exit - t.entry)) / risk;
}

export interface TradeResult {
  /** 수수료 뺀 R */
  r: number;
  /** 수수료 뺀 순손익 (USDT). 수량을 모르면 riskUsdt × R, 그것도 없으면 null */
  pnl: number | null;
  outcome: 'win' | 'loss' | 'be';
}

/** 끝난 거래의 결과. 본전 = ±0.05R 안 */
export function tradeResult(t: Trade): TradeResult | null {
  if (t.exit === null) return null;
  const g = grossR(t, t.exit);
  if (g === null) return null;
  let r = g;
  let pnl: number | null = null;
  if (t.qty !== null && t.qty > 0) {
    const fees = t.feeRate * t.qty * (t.entry + t.exit);
    pnl = t.qty * dirOf(t.side) * (t.exit - t.entry) - fees;
    r = pnl / (t.qty * Math.abs(t.entry - t.sl));
  } else if (t.riskUsdt !== null) {
    pnl = t.riskUsdt * r;
  }
  return { r, pnl, outcome: r > 0.05 ? 'win' : r < -0.05 ? 'loss' : 'be' };
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** 승 ÷ (승 + 패). 거래가 없으면 null */
  winRate: number | null;
  /** 기대값: 거래당 평균 R (수수료 뺌) */
  expectancyR: number | null;
  /** 평균 손익비: 평균 이익 R ÷ 평균 손실 R */
  avgRR: number | null;
  totalR: number;
  netPnl: number;
  /** 규칙 지킨 비율 (규칙 위반이 아닌 거래 ÷ 전체) */
  rcr: number | null;
  ruleBreaks: number;
  /** 규칙 위반 거래의 순손익 합 */
  ruleBreakPnl: number;
}

export function computeStats(trades: Trade[]): Stats {
  const rows = trades.map((t) => ({ t, res: tradeResult(t) })).filter((x): x is { t: Trade; res: TradeResult } => x.res !== null);
  const wins = rows.filter((x) => x.res.outcome === 'win');
  const losses = rows.filter((x) => x.res.outcome === 'loss');
  const n = rows.length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgWin = avg(wins.map((x) => x.res.r));
  const avgLoss = avg(losses.map((x) => x.res.r));
  const breaks = rows.filter((x) => x.t.quality === 'break');
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    breakeven: n - wins.length - losses.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
    expectancyR: avg(rows.map((x) => x.res.r)),
    avgRR: avgWin !== null && avgLoss !== null && avgLoss < 0 ? avgWin / -avgLoss : null,
    totalR: rows.reduce((a, x) => a + x.res.r, 0),
    netPnl: rows.reduce((a, x) => a + (x.res.pnl ?? 0), 0),
    rcr: n ? (n - breaks.length) / n : null,
    ruleBreaks: breaks.length,
    ruleBreakPnl: breaks.reduce((a, x) => a + (x.res.pnl ?? 0), 0),
  };
}

/** 세션 (UTC 시각 기준): 아시아 · 런던 · 뉴욕 오전 · 뉴욕 오후 */
export function sessionOf(ms: number): string {
  const h = new Date(ms).getUTCHours();
  if (h >= 7 && h < 13) return '런던';
  if (h >= 13 && h < 17) return '뉴욕 오전';
  if (h >= 17 && h < 22) return '뉴욕 오후';
  return '아시아';
}

export interface GroupRow {
  key: string;
  stats: Stats;
}

/** 묶음별 성과 (셋업·품질·세션·방향·종목). 표본이 minTrades 미만인 묶음은 뺀다 — 적은 건수의 우연을 거르려고 */
export function groupStats(trades: Trade[], keyOf: (t: Trade) => string, minTrades = MIN_GROUP_TRADES): GroupRow[] {
  const by = new Map<string, Trade[]>();
  for (const t of trades) {
    if (t.exit === null) continue;
    const k = keyOf(t);
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  return [...by]
    .map(([key, list]) => ({ key, stats: computeStats(list) }))
    .filter((g) => g.stats.trades >= minTrades)
    .sort((a, b) => b.stats.totalR - a.stats.totalR);
}

// ---------- 한도·규칙 ----------

/** 한국 시간 기준 하루·주(월요일 시작)·달의 시작 시각 */
export function periodStart(now: number, period: 'day' | 'week' | 'month'): number {
  const KST = 9 * 3600_000;
  const d = new Date(now + KST);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (period === 'month') return Date.UTC(y, m, 1) - KST;
  const day = Date.UTC(y, m, d.getUTCDate()) - KST;
  if (period === 'day') return day;
  const dow = (d.getUTCDay() + 6) % 7; // 월요일 = 0
  return day - dow * 86_400_000;
}

export interface LimitStatus {
  period: 'day' | 'week' | 'month';
  /** 그 기간 끝난 거래의 R 합 */
  r: number;
  limit: number;
  exceeded: boolean;
}

export function limitStatus(trades: Trade[], limits: LossLimits, now: number): LimitStatus[] {
  return (['day', 'week', 'month'] as const).map((period) => {
    const from = periodStart(now, period);
    const r = trades
      .filter((t) => t.closedAt !== null && t.closedAt >= from)
      .reduce((a, t) => a + (tradeResult(t)?.r ?? 0), 0);
    const limit = period === 'day' ? limits.daily : period === 'week' ? limits.weekly : limits.monthly;
    return { period, r, limit, exceeded: limit > 0 && r <= -limit };
  });
}

/** LONG/SHORT 누를 때 띄울 경고 (오늘 기준). 없으면 빈 배열 */
export function entryWarnings(j: Journal, now: number): string[] {
  const out: string[] = [];
  const today = periodStart(now, 'day');
  const { maxTradesPerDay, stopAfterLosses } = j.settings.daily;
  const opened = j.trades.filter((t) => t.openedAt >= today).length;
  if (maxTradesPerDay > 0 && opened >= maxTradesPerDay) out.push(`오늘 ${opened}번 거래 — 하루 최대 ${maxTradesPerDay}번 규칙`);
  if (stopAfterLosses > 0) {
    const closedToday = j.trades.filter((t) => t.closedAt !== null && t.closedAt >= today).sort((a, b) => b.closedAt! - a.closedAt!);
    let streak = 0;
    for (const t of closedToday) {
      if (tradeResult(t)?.outcome !== 'loss') break;
      streak++;
    }
    if (streak >= stopAfterLosses) out.push(`오늘 ${streak}연속 손절 — ${stopAfterLosses}연패면 중단 규칙`);
  }
  const day = limitStatus(j.trades, j.settings.limits, now)[0];
  if (day.exceeded) out.push(`오늘 ${day.r.toFixed(1)}R — 하루 손실 한도 −${day.limit}R 초과`);
  return out;
}

/** 리스크 자동 조절이 정한 지금 위험 % (꺼져 있거나 총 자산을 모르면 null = 손대지 않음) */
export function autoRiskPct(j: Journal, capital: number | null): number | null {
  const a = j.settings.autoRisk;
  if (!a.enabled || !capital || capital <= 0) return null;
  const net = computeStats(j.trades).netPnl;
  return (net / capital) * 100 >= a.thresholdPct ? a.upPct : a.basePct;
}

// ---------- 저장 ----------

export const JOURNAL_KEY = 'rrtool.v1.journal';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function parseTrade(v: unknown): Trade | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.symbol !== 'string' || !/^[A-Z0-9]{2,30}$/.test(r.symbol)) return null;
  if (r.side !== 'LONG' && r.side !== 'SHORT') return null;
  if (!isNum(r.entry) || !isNum(r.sl) || !isNumOrNull(r.tp) || !isNumOrNull(r.qty) || !isNumOrNull(r.riskUsdt) || !isNumOrNull(r.riskPct)) return null;
  if (!isNum(r.openedAt) || !isNumOrNull(r.closedAt) || !isNumOrNull(r.exit)) return null;
  const quality: Quality = r.quality === 'high' || r.quality === 'break' ? r.quality : 'rule';
  return {
    id: r.id.slice(0, 40),
    symbol: r.symbol,
    side: r.side,
    entry: r.entry,
    sl: r.sl,
    tp: (r.tp as number | null) ?? null,
    qty: (r.qty as number | null) ?? null,
    riskUsdt: (r.riskUsdt as number | null) ?? null,
    riskPct: (r.riskPct as number | null) ?? null,
    openedAt: r.openedAt,
    closedAt: (r.closedAt as number | null) ?? null,
    exit: (r.exit as number | null) ?? null,
    setup: str(r.setup, 40),
    quality,
    reason: str(r.reason, 200),
    rules: Array.isArray(r.rules) ? r.rules.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 60)).slice(0, MAX_RULES) : [],
    feeRate: isNum(r.feeRate) && r.feeRate >= 0 && r.feeRate < 0.01 ? r.feeRate : 0.00055,
  };
}

function parseSettings(v: unknown): JournalSettings {
  const d = structuredClone(DEFAULT_JOURNAL_SETTINGS);
  if (!v || typeof v !== 'object') return d;
  const r = v as Record<string, unknown>;
  const list = (x: unknown, max: number, fallback: string[]) =>
    Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, max) : fallback;
  const pos = (x: unknown, fb: number, max: number) => (isNum(x) && x >= 0 && x <= max ? x : fb);
  const daily = (r.daily ?? {}) as Record<string, unknown>;
  const limits = (r.limits ?? {}) as Record<string, unknown>;
  const ar = (r.autoRisk ?? {}) as Record<string, unknown>;
  return {
    setups: list(r.setups, 30, d.setups),
    rules: list(r.rules, MAX_RULES, d.rules),
    daily: { maxTradesPerDay: Math.round(pos(daily.maxTradesPerDay, d.daily.maxTradesPerDay, 100)), stopAfterLosses: Math.round(pos(daily.stopAfterLosses, d.daily.stopAfterLosses, 100)) },
    limits: { daily: pos(limits.daily, d.limits.daily, 100), weekly: pos(limits.weekly, d.limits.weekly, 100), monthly: pos(limits.monthly, d.limits.monthly, 100) },
    autoRisk: {
      enabled: ar.enabled === true,
      basePct: pos(ar.basePct, d.autoRisk.basePct, 10) || d.autoRisk.basePct,
      upPct: pos(ar.upPct, d.autoRisk.upPct, 10) || d.autoRisk.upPct,
      thresholdPct: pos(ar.thresholdPct, d.autoRisk.thresholdPct, 1000),
    },
  };
}

export function parseJournal(raw: string | null): Journal {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object' || v.version !== 1) return emptyJournal();
    const trades = Array.isArray(v.trades) ? (v.trades as unknown[]).map(parseTrade).filter((t): t is Trade => t !== null) : [];
    return { version: 1, trades, settings: parseSettings(v.settings) };
  } catch {
    return emptyJournal();
  }
}

/** CSV (엑셀에서 열기). 쉼표·따옴표가 든 칸은 따옴표로 감싼다 */
export function toCsv(trades: Trade[]): string {
  const head = ['진입 시각', '청산 시각', '종목', '방향', '진입가', '손절가', '목표가', '청산가', '수량', '셋업', '품질', '세션', 'R', '순손익', '근거', '지킨 규칙'];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // 엑셀 수식 주입 방지: =,+,-,@로 시작하는 글자 칸 앞에 '
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const iso = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString());
  const rows = trades.map((t) => {
    const res = tradeResult(t);
    return [iso(t.openedAt), iso(t.closedAt), t.symbol, t.side, t.entry, t.sl, t.tp, t.exit, t.qty, t.setup, QUALITY_LABEL[t.quality], sessionOf(t.openedAt), res ? res.r.toFixed(2) : '', res?.pnl != null ? res.pnl.toFixed(2) : '', t.reason, t.rules.join(' / ')];
  });
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}
