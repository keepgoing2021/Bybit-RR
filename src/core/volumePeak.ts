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
}

function usdOf(c: Candle): { usd: number; approx: boolean } | null {
  if (c.turnover !== undefined && Number.isFinite(c.turnover) && c.turnover > 0) return { usd: c.turnover, approx: false };
  const usd = c.volume * ((c.open + c.high + c.low + c.close) / 4);
  return Number.isFinite(usd) && usd > 0 ? { usd, approx: true } : null;
}

/** 시간순 캔들 → 날마다 거래대금이 가장 큰 캔들 하나 (같으면 먼저 나온 것). 일봉 이상은 빈 목록 */
export function volumePeaks(candles: readonly Candle[], tfMs: number): VolumePeak[] {
  if (!(tfMs > 0) || tfMs >= DAY_MS) return [];
  const out: VolumePeak[] = [];
  let day = Number.NaN;
  let best: VolumePeak | null = null;
  for (const c of candles) {
    const v = usdOf(c);
    if (!v) continue;
    const d = Math.floor(c.time / DAY_MS);
    if (d !== day) {
      if (best) out.push(best);
      best = null;
      day = d;
    }
    if (!best || v.usd > best.usd) best = { time: c.time, high: c.high, low: c.low, usd: v.usd, approx: v.approx };
  }
  if (best) out.push(best);
  return out;
}

/** 35_240_000 → '$35.2M' */
export function fmtUsdShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 999_950) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}
