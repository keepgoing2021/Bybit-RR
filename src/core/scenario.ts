import type { AutoLevels } from './analysis';
import { snapToTick } from './price';
import { tfMs } from './timeframe';
import type { AnalysisSettings } from './settings';
import type { Side, Timeframe } from './types';

export type LevelSource = 'auto' | 'manual';

/** 손익비 계산 하나. 엔트리는 클릭 순간 가격으로 잡고, 지정가 계산을 위해 직접 고칠 수 있다. */
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
  /** LONG/SHORT를 누른 순간 잡은 가격 (자동값으로 되돌리기의 기준). 이 필드 전에 저장된 계산엔 없음 */
  capturedEntry?: number;
  /** 엔트리를 직접 고쳤는지 */
  entryManual?: boolean;
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
  /** 박스를 진입 봉에서 오른쪽으로 옮긴 봉 수. 가격과 무관한 표시 설정 (시간봉을 바꿔도 같은 봉 수) */
  boxShiftBars?: number;
  /** 이전 버전의 이동량 (ms, 생성 시간봉 기준). 읽기만 한다 */
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
    capturedEntry: snapToTick(i.entry.price, i.tickSize),
    entryManual: false,
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

/** 엔트리만 바꾼다 (지정가 주문 계산). SL·TP는 그대로 두고 손익비는 결과로 다시 계산된다 */
export function setEntry(s: Scenario, price: number): Scenario {
  if (s.status !== 'active') return s;
  return { ...s, entry: snapToTick(price, s.tickSize), entryManual: true };
}

/** 생성 당시 자동 제안값과 클릭 순간 엔트리로 되돌린다. 시장 데이터를 다시 분석하지 않는다. */
export function restoreAuto(s: Scenario): Scenario {
  if (s.status !== 'active') return s;
  return {
    ...s,
    entry: s.capturedEntry ?? s.entry,
    entryManual: false,
    applied: { sl: s.auto.sl.price, tp: s.auto.tp.price },
    source: { sl: 'auto', tp: 'auto' },
  };
}

export function closeScenario(s: Scenario, at: { price: number; time: number }): Scenario {
  if (s.status !== 'active') return s;
  return { ...s, status: 'closed', closed: { price: at.price, time: at.time } };
}

/** 박스 그리는 위치만 옮긴다 (봉 단위, 진입 봉보다 왼쪽으로는 안 감). 종료된 시나리오도 가능 */
export function setBoxShift(s: Scenario, bars: number): Scenario {
  const { boxShiftMs: _legacy, ...rest } = s;
  return { ...rest, boxShiftBars: Math.max(0, Math.round(bars)) };
}

/** 박스 이동량 (봉). 이전 버전의 ms 값은 생성 시간봉으로 봉 수로 바꾼다 */
export function boxShiftOf(s: Scenario): number {
  if (s.boxShiftBars !== undefined) return s.boxShiftBars;
  if (s.boxShiftMs) return Math.round(s.boxShiftMs / tfMs(s.timeframe));
  return 0;
}
