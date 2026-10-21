import type { AutoSL, AutoTP } from '../core/analysis';
import type { AnalysisSettings, SlMode } from '../core/settings';
import { tfLabel } from '../core/timeframe';
import type { Side, Timeframe } from '../core/types';

function parts(ms: number, timeZone?: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** '10월 18일 14:15' (기본: 브라우저 현지 시각) */
export function formatTime(ms: number, timeZone?: string): string {
  const p = parts(ms, timeZone);
  return `${p.month}월 ${p.day}일 ${p.hour}:${p.minute}`;
}

/** '14:15:07' */
export function formatClock(ms: number, timeZone?: string): string {
  const p = parts(ms, timeZone);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** '15분봉', '1시간봉', '일봉', '주봉' */
export function tfName(tf: Timeframe): string {
  return `${tfLabel(tf)}봉`;
}

export function formatPct(v: number, signed = false): string {
  const s = Math.abs(v).toFixed(2);
  if (!signed) return `${v < 0 ? '−' : ''}${s}%`;
  return `${v < 0 ? '−' : '+'}${s}%`;
}

/** SL 선정 근거. 예: 'SL: 15분봉 10월 18일 14:15 캔들 저가 (평소 캔들보다 3.21배 길게 움직임)' */
export function slRationale(a: AutoSL, side: Side, timeZone?: string): string {
  if (a.status !== 'ok' || !a.candle) {
    const reason = a.reason ?? '유효한 자동 SL 없음';
    return a.candle ? `${reason} (선정 캔들 ${tfName(a.timeframe)} ${formatTime(a.candle.time, timeZone)})` : reason;
  }
  const edge = side === 'LONG' ? '저가' : '고가';
  const sign = side === 'LONG' ? '−' : '+';
  const buffer =
    (a.bufferPct ?? 0) > 0 ? ` ${sign} 스탑 털림 방지 ${a.bufferPct}%` : (a.bufferTicks ?? 0) > 0 ? ` ${sign} 버퍼 ${a.bufferTicks}틱` : '';
  if (a.method === 'swing') {
    const kind = side === 'LONG' ? '저점' : '고점';
    return `SL: ${tfName(a.timeframe)} 최근 확정 스윙 ${kind}${buffer} (${formatTime(a.candle.time, timeZone)} 캔들)`;
  }
  if (a.method === 'lowestN') {
    const extreme = side === 'LONG' ? '최저가' : '최고가';
    const when = `${a.candle.confirmed ? '' : '진행 중인 '}${formatTime(a.candle.time, timeZone)} 캔들`;
    return `SL: ${tfName(a.timeframe)} 최근 ${a.bars ?? '?'}봉 ${extreme}${buffer} (${when})`;
  }
  if (a.method === 'prevCandle') {
    return `SL: ${tfName(a.timeframe)} 직전 마감 봉 ${edge}${buffer} (${formatTime(a.candle.time, timeZone)} 캔들)`;
  }
  // score = 그 캔들 위아래 길이 ÷ 그 전까지의 평소 캔들 크기(ATR)
  const score = a.score === null ? '' : ` (평소 캔들보다 ${a.score.toFixed(2)}배 길게 움직임)`;
  return `SL: ${tfName(a.timeframe)} ${formatTime(a.candle.time, timeZone)} 캔들 ${edge}${buffer}${score}`;
}

/** TP 근거. 예: 'TP: 기본 손익비 1:1.5 (손익비 점선이나 입력으로 바꿀 수 있음)' */
export function tpRationale(a: AutoTP, _side: Side, _timeZone?: string): string {
  if (a.status !== 'ok' || !a.rr) return a.reason ?? '유효한 자동 TP 없음';
  return `TP: 기본 손익비 1:${a.rr} (손익비 점선이나 입력으로 바꿀 수 있음)`;
}

/** 자동 제안 설정의 SL 방식 이름 (짧게) */
export const SL_MODE_NAMES: Record<SlMode, string> = {
  swing: '스윙 저점·고점',
  lowestN: '최근 N봉 최저·최고',
  prevCandle: '직전 봉',
  spike: '가장 큰 캔들',
};

/** SL 방식 한 줄 설명 (LONG 기준, SHORT는 반대). 시간봉은 상단 'SL 기준' */
export const SL_MODE_HELP: Record<SlMode, string> = {
  swing: '최근 꺾인 저점 (숏은 고점)',
  lowestN: '최근 N봉 중 최저가 (숏은 최고가)',
  prevCandle: '직전 봉의 저가 (숏은 고가)',
  spike: '평소보다 크게 움직인 캔들의 꼬리',
};

/** 자동 제안 설정 접힌 상태에서도 보이는 한 줄 요약. 예: '스윙 2봉 · 1:1.5' */
export function settingsSummary(s: AnalysisSettings): string {
  const how =
    s.slMode === 'swing'
      ? `스윙 ${s.swingBars}봉`
      : s.slMode === 'lowestN'
        ? `최근 ${s.slLowestBars}봉 최저`
        : s.slMode === 'spike'
          ? `큰 캔들 ${s.lookback}봉`
          : '직전 봉';
  // 스탑 털림 방지는 패널 손절 줄 아래에 따로 있어서 요약에서 뺀다
  return `${how} · 1:${s.defaultRR}`;
}

/**
 * 칩처럼 좁은 자리의 USDT 금액. 1만 미만은 쉼표 정수(100 미만은 소수 둘째 자리), 그 위는 K·M.
 * 예: 12.5 → '12.50', 1523.4 → '1,523', 12_345 → '12.3K', 2_500_000 → '2.50M'
 */
export function compactUsdt(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(1)}K`;
  if (a >= 100) return `${sign}${Math.round(a).toLocaleString('en-US')}`;
  return `${sign}${a.toFixed(2)}`;
}
