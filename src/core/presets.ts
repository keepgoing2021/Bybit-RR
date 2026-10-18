import { snapToTick } from './price';
import type { Side } from './types';

export interface PresetLevel {
  /** 엔트리 대비 가격 변동률 (%, 레버리지 미반영) */
  pct: number;
  price: number;
  /** 수익 쪽이면 TP, 손실 쪽이면 SL */
  target: 'sl' | 'tp';
}

export const PRESET_PCTS = [5, 3, 1, -1, -3, -5];

/** 엔트리 ±1·3·5% 가격. LONG은 위가 TP·아래가 SL, SHORT는 반대 */
export function presetLevels(side: Side, entry: number, tickSize: number, pcts: number[] = PRESET_PCTS): PresetLevel[] {
  return pcts.map((pct) => {
    const profitSide = side === 'LONG' ? pct > 0 : pct < 0;
    return { pct, price: snapToTick(entry * (1 + pct / 100), tickSize), target: profitSide ? 'tp' : 'sl' };
  });
}
