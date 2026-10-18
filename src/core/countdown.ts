/** 현재 캔들 마감까지 남은 시간 (거래소 시각 기준, 0 미만이면 0) */
export function barRemainingMs(barStart: number, tfMs: number, serverNow: number): number {
  return Math.max(0, barStart + tfMs - serverNow);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** TradingView 가격축 카운트다운 표기: 'mm:ss', 'hh:mm:ss', 'Nd Nh' */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
