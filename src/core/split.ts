import { TIMEFRAMES } from './timeframe';
import type { Timeframe } from './types';

/**
 * 화면 분할(멀티차트, 2026-11-06). 첫 칸은 늘 계산기 칸(앱의 종목·시간봉), 나머지 칸은 보기용.
 * 보기 칸 기본값은 같은 종목의 더 큰 시간봉 — 「큰 흐름 보면서 진입」
 */
export type SplitCount = 1 | 2 | 4;
export const SPLITS: SplitCount[] = [1, 2, 4];

export interface PaneSel {
  symbol: string;
  tf: Timeframe;
}

export interface SplitState {
  n: SplitCount;
  /** 보기 칸들 (계산기 칸 제외). 칸 수보다 많아도 남겨 둔다 — 4칸 → 2칸 → 4칸이면 원래대로 */
  panes: PaneSel[];
}

/** 보기 칸 기본 시간봉 사다리 */
const LADDER: Timeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];

/** 계산기 칸 시간봉보다 큰 것부터 count개 (모자라면 큰 쪽에서 채움) */
export function defaultPaneTfs(main: Timeframe, count: number): Timeframe[] {
  const rank = TIMEFRAMES.indexOf(main);
  const above = LADDER.filter((t) => TIMEFRAMES.indexOf(t) > rank);
  const out = [...above];
  for (const t of [...LADDER].reverse()) if (out.length < count && !out.includes(t) && t !== main) out.push(t);
  return out.slice(0, count);
}

/** 칸 수에 맞게 보기 칸을 채운다 (이미 고른 칸은 그대로) */
export function fillPanes(state: SplitState, mainSymbol: string, mainTf: Timeframe): PaneSel[] {
  const need = state.n - 1;
  const out = state.panes.slice();
  if (out.length >= need) return out;
  const used = new Set(out.map((p) => p.tf));
  const tfs = defaultPaneTfs(mainTf, need + 3).filter((t) => !used.has(t));
  while (out.length < need) out.push({ symbol: mainSymbol, tf: tfs.shift() ?? 'D' });
  return out;
}

export function parseSplit(raw: string | null): SplitState {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const n = SPLITS.includes(v?.n) ? (v.n as SplitCount) : 1;
    const panes = Array.isArray(v?.panes)
      ? (v.panes as unknown[])
          .filter((p): p is PaneSel => {
            const x = p as PaneSel;
            return typeof x?.symbol === 'string' && /^[A-Z0-9]{2,30}$/.test(x.symbol) && TIMEFRAMES.includes(x.tf);
          })
          .slice(0, 3)
      : [];
    return { n, panes };
  } catch {
    return { n: 1, panes: [] };
  }
}
