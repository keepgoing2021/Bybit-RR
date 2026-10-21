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
    return `SL: ${tfName(a.timeframe)} 최근 ${kind}${buffer} (${formatTime(a.candle.time, timeZone)} 캔들 ${edge})`;
  }
  if (a.method === 'lowestN') {
    const extreme = side === 'LONG' ? '최저가' : '최고가';
    const when = `${a.candle.confirmed ? '' : '진행 중인 '}${formatTime(a.candle.time, timeZone)} 캔들`;
    return `SL: ${tfName(a.timeframe)} ${a.bars ?? '?'}봉 중 ${extreme}${buffer} (${when})`;
  }
  if (a.method === 'prevCandle') {
    return `SL: ${tfName(a.timeframe)} 직전 봉 ${edge}${buffer} (${formatTime(a.candle.time, timeZone)} 캔들)`;
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

/**
 * 자동 제안 설정의 SL 방식 이름 (짧게). 트레이더 용어(스윙) 대신 차트 모양으로 부른다:
 * '저점·고점' = 꺾인 바닥·꼭대기, '최저·최고가' = 구간 안에서 가장 낮은·높은 값
 */
export const SL_MODE_NAMES: Record<SlMode, string> = {
  swing: '최근 저점·고점',
  lowestN: 'N봉 중 최저·최고가',
  prevCandle: '직전 봉 저가·고가',
  spike: '가장 큰 캔들',
};

/** SL 방식 한 줄 설명 (LONG 기준, SHORT는 반대). 시간봉은 상단 'SL 기준' */
export const SL_MODE_HELP: Record<SlMode, string> = {
  swing: '내려왔다 다시 오른 바닥 (숏은 올라갔다 다시 내린 꼭대기)',
  lowestN: '최근 N봉 중 가장 낮은 가격 (숏은 가장 높은 가격)',
  prevCandle: '바로 앞 봉의 저가 (숏은 고가)',
  spike: '평소보다 크게 움직인 캔들의 꼬리',
};

/**
 * '최근 저점' 방식에서 저점으로 칠 바닥의 크기 (= 양옆으로 몇 봉보다 낮아야 하는지, swingBars).
 * 숫자 대신 세 단계로 고른다. 저장된 값이 이 밖이면(예: 5) '양옆 5봉'으로 보여 준다
 */
export const SWING_LEVELS: [number, string][] = [
  [1, '잔물결도 (SL 가깝게)'],
  [2, '보통'],
  [3, '큰 굽이만 (SL 멀게)'],
];

export function swingLevelName(bars: number): string {
  if (bars === 1) return '잔물결도';
  if (bars === 3) return '큰 굽이만';
  return bars === 2 ? '보통' : `양옆 ${bars}봉`;
}

/** 자동 제안 설정 접힌 상태에서도 보이는 한 줄 요약. 예: '최근 저점·고점 · 1:1.5' (바닥 크기는 기본 '보통'이 아닐 때만) */
export function settingsSummary(s: AnalysisSettings): string {
  const how =
    s.slMode === 'swing'
      ? `최근 저점·고점${s.swingBars === 2 ? '' : ` (${swingLevelName(s.swingBars)})`}`
      : s.slMode === 'lowestN'
        ? `${s.slLowestBars}봉 중 최저·최고가`
        : s.slMode === 'spike'
          ? `큰 캔들 ${s.lookback}봉`
          : '직전 봉 저가·고가';
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
