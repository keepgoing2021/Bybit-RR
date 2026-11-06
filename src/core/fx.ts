/**
 * 환율 (ECB 기준값, Frankfurter 무료 API — 가입 없음, 하루 한 번, 2026-11-07).
 * 트레이딩뷰 이름 'FX_IDC:USDKRW', 'FX_IDC:JPYKRW*100', 'FOREXCOM:AUDUSD' → 통화쌍
 */
export interface FxPair {
  base: string;
  quote: string;
  /** JPYKRW*100 같은 배수 */
  mult: number;
}

/** ECB(Frankfurter)가 주는 통화 */
export const FX_CURRENCIES = 'AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR'.split(' ');
const isCcy = (c: string) => FX_CURRENCIES.includes(c);

export function tvFxPair(tv: string): FxPair | null {
  const [ex, rest] = tv.includes(':') ? tv.split(':', 2) : ['', tv];
  if (!(ex.startsWith('FX') || ex === 'FOREXCOM' || ex === 'OANDA' || ex === 'SAXO')) return null;
  const m = /^([A-Z]{3})_?([A-Z]{3})(?:\*(\d{1,6}))?$/.exec(rest ?? '');
  if (!m || !isCcy(m[1]) || !isCcy(m[2]) || m[1] === m[2]) return null;
  return { base: m[1], quote: m[2], mult: m[3] ? Number(m[3]) : 1 };
}

/** USD 기준 환율표(rates[X] = 1달러에 X)로 base→quote 값 */
export function fxValue(rates: Record<string, number>, p: FxPair): number | null {
  const r = (c: string) => (c === 'USD' ? 1 : rates[c]);
  const b = r(p.base);
  const q = r(p.quote);
  if (!(b > 0) || !(q > 0)) return null;
  return (q / b) * p.mult;
}

/** Frankfurter 기간 응답 { rates: { 'YYYY-MM-DD': { KRW: … } } } → 마지막 두 날짜 */
export function lastTwo(body: unknown): { today: Record<string, number>; prev: Record<string, number> | null; date: string } | null {
  const rates = (body as { rates?: Record<string, Record<string, number>> } | null)?.rates;
  if (!rates || typeof rates !== 'object') return null;
  const days = Object.keys(rates).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!days.length) return null;
  const today = rates[days[days.length - 1]];
  const prev = days.length > 1 ? rates[days[days.length - 2]] : null;
  return { today, prev, date: days[days.length - 1] };
}
