import type { AutoSL, AutoTP } from '../core/analysis';
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

/** SL 선정 근거. 예: 'SL: 15분봉 10월 18일 14:15 캔들 저가 (고저폭이 직전 ATR의 3.21배)' */
export function slRationale(a: AutoSL, side: Side, timeZone?: string): string {
  if (a.status !== 'ok' || !a.candle) {
    const reason = a.reason ?? '유효한 자동 SL 없음';
    return a.candle ? `${reason} (선정 캔들 ${tfName(a.timeframe)} ${formatTime(a.candle.time, timeZone)})` : reason;
  }
  const edge = side === 'LONG' ? '저가' : '고가';
  const buffer = a.bufferTicks > 0 ? ` ${side === 'LONG' ? '−' : '+'} 버퍼 ${a.bufferTicks}틱` : '';
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
  const score = a.score === null ? '' : ` (고저폭이 직전 ATR의 ${a.score.toFixed(2)}배)`;
  return `SL: ${tfName(a.timeframe)} ${formatTime(a.candle.time, timeZone)} 캔들 ${edge}${buffer}${score}`;
}

/** TP 선정 근거. 예: 'TP: 4시간봉의 확정 스윙 고점 (10월 17일 08:00 캔들, 10월 17일 16:00 확정)' */
export function tpRationale(a: AutoTP, side: Side, timeZone?: string): string {
  if (a.status !== 'ok' || !a.swing || !a.timeframe) return a.reason ?? '유효한 자동 TP 없음';
  const kind = side === 'LONG' ? '고점' : '저점';
  return `TP: ${tfName(a.timeframe)}의 확정 스윙 ${kind} (${formatTime(a.swing.time, timeZone)} 캔들, ${formatTime(a.swing.confirmedAt, timeZone)} 확정)`;
}
