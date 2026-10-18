import { snapToTick } from './price';
import type { Side } from './types';

/** 박스 안 점선 하나. 누르면 그 가격으로 TP(또는 SL)를 정한다 */
export interface PresetLevel {
  id: string;
  label: string;
  price: number;
  target: 'sl' | 'tp';
}

/** 박스 오른쪽에 그리는 손익비 점선 */
export const RR_LEVELS = [1, 1.3, 1.5, 1.7, 2, 2.5, 3];

/**
 * 손익비 rr이 되는 TP. 사용자가 손익비를 직접 고르거나 입력할 때만 쓴다 —
 * 자동 제안 TP는 가격 구조(스윙)로만 정하고 RR로 역산하지 않는다.
 * SL이 엔트리 반대편(LONG은 아래)에 있어야 하고 rr > 0.
 */
export function tpForRR(side: Side, entry: number, sl: number | null, rr: number, tickSize: number): number | null {
  if (sl === null || !(rr > 0)) return null;
  const sign = side === 'LONG' ? 1 : -1;
  const risk = sign * (entry - sl);
  if (!(risk > 0)) return null;
  // 틱 정수로 계산: 실수 오차로 반 틱(예: 65121.35)이 어떤 때는 내림, 어떤 때는 올림되던 것을 막는다.
  // 정확히 반 틱이면 엔트리에서 먼 쪽(손익비가 고른 값 이상)으로
  const entryTicks = Math.round(entry / tickSize);
  const riskTicks = Math.round(risk / tickSize);
  const rewardTicks = Math.floor(rr * riskTicks + 0.5 + 1e-9);
  return snapToTick((entryTicks + sign * rewardTicks) * tickSize, tickSize);
}

/** 손익비 점선 (1:1 ~ 1:3). SL이 유효하지 않으면 없음 */
export function rrLevels(side: Side, entry: number, sl: number | null, tickSize: number, rrs: number[] = RR_LEVELS): PresetLevel[] {
  return rrs.flatMap((rr) => {
    const price = tpForRR(side, entry, sl, rr, tickSize);
    return price === null ? [] : [{ id: `rr-${rr}`, label: `1:${rr}`, price, target: 'tp' as const }];
  });
}

/** '1.5', '1:1.5', ' 1 : 2 ' → 숫자. 0 이하·숫자 아님은 null */
export function parseRR(text: string): number | null {
  const t = text.trim().replace(/^1\s*:\s*/, '');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}
