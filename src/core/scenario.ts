import type { AutoLevels } from './analysis';
import { snapToTick } from './price';
import type { AnalysisSettings } from './settings';
import type { Side, Timeframe } from './types';

export type LevelSource = 'auto' | 'manual';

/** 가상 매매 시나리오. 엔트리는 생성 후 바뀌지 않는다. */
export interface Scenario {
  version: 1;
  id: string;
  symbol: string;
  /** 생성 당시 차트 시간봉 (SL 분석 기준) */
  timeframe: Timeframe;
  /** 생성 당시 TP 분석용 상위 시간봉 */
  htf: Timeframe | null;
  side: Side;
  entry: number;
  tickSize: number;
  /** LONG/SHORT를 누른 시각 (브라우저 시계, ms) */
  clickedAt: number;
  /** 엔트리 가격 데이터의 시각 (거래소 시계, ms) = 자동 선정 기준 시각 */
  priceTime: number;
  priceSource: 'trade' | 'ticker';
  /** 생성 당시 자동 제안 결과. 이후 절대 바뀌지 않는다. */
  auto: AutoLevels;
  /** 현재 적용 중인 값 */
  applied: { sl: number | null; tp: number | null };
  source: { sl: LevelSource; tp: LevelSource };
  /** 생성에 사용한 설정 */
  settings: AnalysisSettings;
  status: 'active' | 'closed';
  closed: { price: number; time: number } | null;
  /** 박스를 그리는 위치를 오른쪽으로 옮긴 양 (ms). 가격과 무관한 표시 설정 */
  boxShiftMs?: number;
}

export interface CreateScenarioInput {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  htf: Timeframe | null;
  side: Side;
  entry: { price: number; priceTime: number; source: 'trade' | 'ticker'; clickedAt: number };
  tickSize: number;
  auto: AutoLevels;
  settings: AnalysisSettings;
}

export function createScenario(i: CreateScenarioInput): Scenario {
  return {
    version: 1,
    id: i.id,
    symbol: i.symbol,
    timeframe: i.timeframe,
    htf: i.htf,
    side: i.side,
    entry: snapToTick(i.entry.price, i.tickSize),
    tickSize: i.tickSize,
    clickedAt: i.entry.clickedAt,
    priceTime: i.entry.priceTime,
    priceSource: i.entry.source,
    auto: i.auto,
    applied: { sl: i.auto.sl.price, tp: i.auto.tp.price },
    source: { sl: 'auto', tp: 'auto' },
    settings: i.settings,
    status: 'active',
    closed: null,
  };
}

/** SL 또는 TP 하나만 바꾼다. 반대쪽 값과 엔트리는 그대로 둔다. 종료된 시나리오는 바꾸지 않는다. */
export function setLevel(s: Scenario, which: 'sl' | 'tp', price: number | null): Scenario {
  if (s.status !== 'active') return s;
  const value = price === null ? null : snapToTick(price, s.tickSize);
  return {
    ...s,
    applied: { ...s.applied, [which]: value },
    source: { ...s.source, [which]: 'manual' },
  };
}

/** 생성 당시 자동 제안값으로 되돌린다. 시장 데이터를 다시 분석하지 않는다. */
export function restoreAuto(s: Scenario): Scenario {
  if (s.status !== 'active') return s;
  return {
    ...s,
    applied: { sl: s.auto.sl.price, tp: s.auto.tp.price },
    source: { sl: 'auto', tp: 'auto' },
  };
}

export function closeScenario(s: Scenario, at: { price: number; time: number }): Scenario {
  if (s.status !== 'active') return s;
  return { ...s, status: 'closed', closed: { price: at.price, time: at.time } };
}

/** 박스 그리는 위치만 옮긴다 (엔트리 시점보다 왼쪽으로는 안 감). 종료된 시나리오도 가능 */
export function setBoxShift(s: Scenario, shiftMs: number): Scenario {
  return { ...s, boxShiftMs: Math.max(0, shiftMs) };
}
