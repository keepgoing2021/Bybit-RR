import type { Candle } from './types';

/**
 * 하루 중 거래가 가장 많이 터진 캔들 (2026-11-11 사용자 요청).
 * 하루 = UTC 자정 ~ 다음 자정 (한국 시간 오전 9시, Bybit 일봉과 같은 경계).
 * 금액 = 그 캔들의 거래대금(USDT ≈ 달러). 거래대금이 없는 캔들은 거래량 × 평균가로 어림한다(approx)
 */
export const DAY_MS = 86_400_000;

export interface VolumePeak {
  /** 캔들 시작 시각 (ms) */
  time: number;
  high: number;
  low: number;
  /** 그 캔들 하나의 거래대금 (USDT) */
  usd: number;
  /** 거래대금 값이 없어 거래량 × 평균가로 어림한 값 */
  approx: boolean;
  /** 바로 앞 20봉 평균 거래대금의 몇 배인지 (앞 봉이 5개 미만이면 null) */
  ratio: number | null;
  /** 가격 구간 선이 끝나는 시각 = 다음 날(한 주 기준이면 다음 주) 끝 (최근 것은 차트 오른쪽 끝까지 간다) */
  bandEnd: number;
}

/** 평소 거래대금 기준: 바로 앞 몇 봉의 평균과 비교하나 */
export const RATIO_BARS = 20;
const RATIO_MIN_BARS = 5;

function usdOf(c: Candle): { usd: number; approx: boolean } | null {
  if (c.turnover !== undefined && Number.isFinite(c.turnover) && c.turnover > 0) return { usd: c.turnover, approx: false };
  const usd = c.volume * ((c.open + c.high + c.low + c.close) / 4);
  return Number.isFinite(usd) && usd > 0 ? { usd, approx: true } : null;
}

/** 몇 마다 하나씩 표시하나: 하루, 또는 (차트를 넓게 봐서 하루가 좁을 때) 한 주 = 월요일 UTC 자정 ~ 다음 월요일 */
export type PeakPeriod = 'day' | 'week';

/** 하루 폭(px)이 이보다 좁으면 이름표끼리 겹치니 한 주 기준으로 바꾼다 (이름표 하나가 100px 안팎) */
export const DAY_MIN_PX = 120;

/** 봉 하나의 폭(px)과 시간봉 → 표시 기준. 2026-11-12: 넓게 보면 날마다 붙은 이름표가 겹쳐 캔들을 덮었다 */
export function peakPeriodFor(barPx: number, tfMs: number): PeakPeriod {
  if (!(barPx > 0) || !(tfMs > 0)) return 'day';
  return barPx * (DAY_MS / tfMs) >= DAY_MIN_PX ? 'day' : 'week';
}

/** 그 날(UTC 일 번호)이 속한 구간의 시작 일 번호와 길이(일). 1970-01-05(일 번호 4)가 월요일 */
function periodOf(day: number, period: PeakPeriod): { start: number; days: number } {
  if (period === 'day') return { start: day, days: 1 };
  return { start: Math.floor((day - 4) / 7) * 7 + 4, days: 7 };
}

/** 시간순 캔들 → 하루(또는 한 주)마다 거래대금이 가장 큰 캔들 하나 (같으면 먼저 나온 것). 일봉 이상은 빈 목록 */
export function volumePeaks(candles: readonly Candle[], tfMs: number, period: PeakPeriod = 'day'): VolumePeak[] {
  if (!(tfMs > 0) || tfMs >= DAY_MS) return [];
  const out: VolumePeak[] = [];
  // 앞 20봉 평균용: 값이 있는 봉의 거래대금을 순서대로 모은다
  const usd: number[] = [];
  let day = Number.NaN;
  let best: VolumePeak | null = null;
  for (const c of candles) {
    const v = usdOf(c);
    if (!v) continue;
    const span = periodOf(Math.floor(c.time / DAY_MS), period);
    const d = span.start;
    if (d !== day) {
      if (best) out.push(best);
      best = null;
      day = d;
    }
    if (!best || v.usd > best.usd) {
      const prev = usd.slice(-RATIO_BARS);
      const avg = prev.length >= RATIO_MIN_BARS ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
      best = { time: c.time, high: c.high, low: c.low, usd: v.usd, approx: v.approx, ratio: avg > 0 ? v.usd / avg : null, bandEnd: (d + 2 * span.days) * DAY_MS };
    }
    usd.push(v.usd);
  }
  if (best) out.push(best);
  return out;
}

/** 4.23 → '4.2배', 12.6 → '13배' */
export function fmtRatio(r: number): string {
  return `${r >= 10 ? Math.round(r) : r.toFixed(1)}배`;
}

/** 35_240_000 → '$35.2M' */
export function fmtUsdShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 999_950) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}
