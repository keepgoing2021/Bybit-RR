/**
 * 오래된 계산 알림 (2026-11-11). 계산은 브라우저에 남아 다음 날 열어도 그대로 보인다.
 * 「시장가로 계산」이 어제 가격이면 진입가·수량이 지금 시세와 안 맞으므로, 얼마나 됐고 지금 가격과 얼마나 벌어졌는지 알려 준다.
 */
export const PLAN_OLD_MS = 3600_000;

export interface PlanAge {
  /** '20시간 전 계산 · 지금 가격은 진입가보다 −8.1%'. 1시간이 안 됐으면 null */
  text: string | null;
  /** 시장가로 잡은 계산이 오래됨 → 다시 계산하라고 강조. 지정가(직접 넣은 진입가)는 기다리는 주문이라 강조하지 않는다 */
  warn: boolean;
}

export function planAge(clickedAt: number, entry: number, live: number | null, now: number, entryManual: boolean): PlanAge {
  const age = now - clickedAt;
  if (!(age >= PLAN_OLD_MS)) return { text: null, warn: false };
  const hours = Math.floor(age / 3600_000);
  const ago = hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
  let gap = '';
  if (live !== null && live > 0 && entry > 0) {
    const pct = ((live - entry) / entry) * 100;
    const shown = Math.abs(pct) < 0.05 ? '0.0' : `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}`;
    gap = ` · 지금 가격은 진입가보다 ${shown}%`;
  }
  return { text: `${ago} 계산${gap}${entryManual ? '' : ' — LONG/SHORT를 다시 눌러 새로 계산하세요'}`, warn: !entryManual };
}

/** 같은 날(브라우저 현지 시각)인지 — 다른 날 계산이면 시각 앞에 날짜를 붙인다 */
export function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
