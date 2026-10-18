import { decimalsOf, ticksBetween } from './price';
import type { Side } from './types';

export interface MetricsInput {
  side: Side;
  entry: number;
  sl: number | null;
  tp: number | null;
  current: number | null;
  tickSize: number;
}

export interface Metrics {
  /** SL < 엔트리 < TP (LONG) / TP < 엔트리 < SL (SHORT) 이고 위험 거리 > 0 */
  valid: boolean;
  reasons: string[];
  riskDist: number | null;
  rewardDist: number | null;
  riskTicks: number | null;
  rewardTicks: number | null;
  riskPct: number | null;
  rewardPct: number | null;
  /** 보상 ÷ 위험. 유효할 때만 값이 있다. */
  rr: number | null;
  /** 현재가 기준 R 배수. SL이 올바른 쪽에 있고 위험 거리 > 0일 때만 값이 있다. */
  currentR: number | null;
  /** 방향을 반영한 현재 가격 수익률(%) */
  currentPct: number | null;
}

/**
 * 가격 기준 손익비 계산. 수수료·슬리피지·레버리지는 반영하지 않는다.
 * RR은 틱 정수 비율로 계산해 부동소수 오차를 피한다.
 */
export function computeMetrics(i: MetricsInput): Metrics {
  const { side, entry, sl, tp, current, tickSize } = i;
  const dir = side === 'LONG' ? 1 : -1;
  const dec = decimalsOf(tickSize);
  const toPrice = (ticks: number) => Number((ticks * tickSize).toFixed(dec));
  const reasons: string[] = [];

  const riskTicks = sl === null ? null : ticksBetween(entry, sl, tickSize);
  const rewardTicks = tp === null ? null : ticksBetween(entry, tp, tickSize);
  const riskDist = riskTicks === null ? null : toPrice(riskTicks);
  const rewardDist = rewardTicks === null ? null : toPrice(rewardTicks);

  let slOk = false;
  if (sl === null) {
    reasons.push('SL 미설정');
  } else if (riskTicks === 0) {
    reasons.push('위험 거리가 0입니다 (SL = 엔트리)');
  } else if (dir * (entry - sl) < 0) {
    reasons.push(side === 'LONG' ? 'LONG의 SL은 엔트리보다 낮아야 합니다' : 'SHORT의 SL은 엔트리보다 높아야 합니다');
  } else {
    slOk = true;
  }

  if (tp === null) {
    reasons.push('TP 미설정');
  } else if (rewardTicks === 0) {
    reasons.push('보상 거리가 0입니다 (TP = 엔트리)');
  } else if (dir * (tp - entry) < 0) {
    reasons.push(side === 'LONG' ? 'LONG의 TP는 엔트리보다 높아야 합니다' : 'SHORT의 TP는 엔트리보다 낮아야 합니다');
  }

  const valid = reasons.length === 0;

  return {
    valid,
    reasons,
    riskDist,
    rewardDist,
    riskTicks,
    rewardTicks,
    riskPct: riskDist === null ? null : (riskDist / entry) * 100,
    rewardPct: rewardDist === null ? null : (rewardDist / entry) * 100,
    rr: valid ? rewardTicks! / riskTicks! : null,
    currentR: slOk && current !== null ? (dir * (current - entry)) / riskDist! : null,
    currentPct: current === null ? null : ((dir * (current - entry)) / entry) * 100,
  };
}

/** 리스크:보상 표기. 소수 둘째 자리까지, 끝의 0은 지운다. */
export function formatRR(rr: number): string {
  return `1:${Number(rr.toFixed(2))}`;
}
