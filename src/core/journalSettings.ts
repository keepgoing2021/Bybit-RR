import { limitStatus, periodStart, tradeResult, type AutoRisk, type Journal, type LossLimits } from './journal';

/**
 * 매매일지 「설정」 화면용 순수 함수 (2026-11-12 개편: 저장 버튼 없이 바로 저장, 칩 편집, − / + 버튼).
 * 화면(src/journal/settings.ts)은 여기 결과만 그린다.
 */
export const ITEM_MAX_CHARS = 60;
export const MAX_SETUPS = 30;

export type ListEdit = { ok: true; list: string[] } | { ok: false; reason: string };

const clean = (text: string) => text.trim().slice(0, ITEM_MAX_CHARS);

export function addItem(list: readonly string[], text: string, max: number): ListEdit {
  const v = clean(text);
  if (!v) return { ok: false, reason: '내용을 적어 주세요.' };
  if (list.includes(v)) return { ok: false, reason: '이미 있는 항목이에요.' };
  if (list.length >= max) return { ok: false, reason: `최대 ${max}개까지예요. 하나를 지우고 추가해 주세요.` };
  return { ok: true, list: [...list, v] };
}

export function renameItem(list: readonly string[], index: number, text: string): ListEdit {
  const v = clean(text);
  if (!v) return { ok: false, reason: '내용을 적어 주세요.' };
  if (list.some((x, i) => x === v && i !== index)) return { ok: false, reason: '이미 있는 항목이에요.' };
  return { ok: true, list: list.map((x, i) => (i === index ? v : x)) };
}

export function removeItem(list: readonly string[], index: number): string[] {
  return list.filter((_, i) => i !== index);
}

export interface StepRange {
  step: number;
  min: number;
  max: number;
}

/** − / + 한 번(dir = −1 / +1) 또는 직접 친 값(dir = 0)을 걸음·범위에 맞춘다. 숫자가 아니면 fallback */
export function stepValue(value: number, dir: -1 | 0 | 1, r: StepRange, fallback = r.min): number {
  if (!Number.isFinite(value)) return fallback;
  const moved = Math.round((value + dir * r.step) / r.step) * r.step;
  const clamped = Math.min(r.max, Math.max(r.min, moved));
  return Math.round(clamped * 1000) / 1000;
}

export type LimitPresetKey = 'safe' | 'normal' | 'bold';
export const LIMIT_PRESETS: readonly { key: LimitPresetKey; label: string; limits: LossLimits }[] = [
  { key: 'safe', label: '보수적', limits: { daily: 2, weekly: 4, monthly: 8 } },
  { key: 'normal', label: '보통', limits: { daily: 3, weekly: 6, monthly: 10 } },
  { key: 'bold', label: '공격적', limits: { daily: 5, weekly: 10, monthly: 15 } },
];

export function presetOf(l: LossLimits): LimitPresetKey | null {
  return LIMIT_PRESETS.find((p) => p.limits.daily === l.daily && p.limits.weekly === l.weekly && p.limits.monthly === l.monthly)?.key ?? null;
}

/** 그 기간 R 합(r)과 한도 → 한도를 얼마나 썼나 (번 기간은 0). 한도 0 = 끔 */
export function limitUsage(r: number, limit: number): { used: number; ratio: number; off: boolean } {
  const used = Math.max(0, -r);
  if (!(limit > 0)) return { used, ratio: 0, off: true };
  return { used, ratio: Math.min(1, used / limit), off: false };
}

/** 오늘(한국 시간) 연 거래 수와, 오늘 끝난 거래 기준 지금 연속 손절 수 — entryWarnings와 같은 셈법 */
export function dailyStatus(j: Journal, now: number): { openedToday: number; lossStreak: number } {
  const today = periodStart(now, 'day');
  const openedToday = j.trades.filter((t) => t.openedAt >= today).length;
  const closedToday = j.trades.filter((t) => t.closedAt !== null && t.closedAt >= today).sort((a, b) => b.closedAt! - a.closedAt!);
  let lossStreak = 0;
  for (const t of closedToday) {
    if (tradeResult(t)?.outcome !== 'loss') break;
    lossStreak++;
  }
  return { openedToday, lossStreak };
}

/** 기간별 한도 사용량 (하루·한 주·한 달) */
export function limitRows(j: Journal, now: number): { period: 'day' | 'week' | 'month'; r: number; limit: number; used: number; ratio: number; off: boolean }[] {
  return limitStatus(j.trades, j.settings.limits, now).map((s) => ({ period: s.period, r: s.r, limit: s.limit, ...limitUsage(s.r, s.limit) }));
}

/** 위험 자동 조절을 총 자산 기준 금액으로 풀어 쓴 예시 */
export function autoRiskExample(a: AutoRisk, capital: number): { capital: number; base: number; up: number; threshold: number } {
  const pct = (p: number) => Math.round(capital * p) / 100;
  return { capital, base: pct(a.basePct), up: pct(a.upPct), threshold: pct(a.thresholdPct) };
}
