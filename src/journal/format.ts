/** 저널 화면 공통 글자 모양 */
export const fmtR = (r: number | null, digits = 2) => (r === null ? '—' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(digits)}R`);
export const fmtPct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
export const fmtUsd = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const sign = (v: number | null) => (v === null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
/** '2026-11-05' → '11/5' */
export const fmtDay = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
export function fmtHold(ms: number | null): string {
  if (ms === null) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}시간 ${min % 60}분` : `${Math.floor(h / 24)}일 ${h % 24}시간`;
}
/** 진행 중 카드의 흐르는 시간: 1시간 전에는 초까지 ('12분 05초'), 그 뒤로는 fmtHold와 같다 */
export function fmtElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 3600) return `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초`;
  return fmtHold(sec * 1000);
}
