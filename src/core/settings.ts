import type { AtrMethod } from './atr';
import type { TpMode } from './swing';

/** 확정된 전략이 아닌 MVP 초기 가정값. 설정 패널에서 바꿀 수 있다. */
export type SlMode = 'prevCandle' | 'spike';

export interface AnalysisSettings {
  /** SL 방식: SL 기준 시간봉의 직전 마감 봉(기본) / 차트 시간봉의 가장 급격한 캔들 */
  slMode: SlMode;
  /** 급격한 캔들 탐색 범위 (직전 확정 캔들 수) */
  lookback: number;
  atrPeriod: number;
  atrMethod: AtrMethod;
  /** SL 버퍼 (틱). LONG은 아래로, SHORT는 위로 더한다. */
  slBufferTicks: number;
  /** 스윙 판별 봉 수 (좌우 각각) */
  swingBars: number;
  tpMode: TpMode;
  /** 박스 오른쪽 끝: 최신 봉에서 몇 봉 앞까지 */
  boxExtendBars: number;
  /** 이 시간 동안 웹소켓 메시지가 없으면 연결 지연(stale) */
  staleAfterSec: number;
  /** 최신 가격의 나이가 이보다 크면 시나리오 생성 차단 */
  maxPriceAgeSec: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  slMode: 'prevCandle',
  lookback: 50,
  atrPeriod: 14,
  atrMethod: 'wilder',
  slBufferTicks: 0,
  swingBars: 2,
  tpMode: 'latest',
  boxExtendBars: 10,
  staleAfterSec: 15,
  maxPriceAgeSec: 60,
};

type NumericKey = Exclude<keyof AnalysisSettings, 'atrMethod' | 'tpMode' | 'slMode'>;

export const SETTING_RANGES: Record<NumericKey, [number, number]> = {
  lookback: [5, 500],
  atrPeriod: [2, 200],
  slBufferTicks: [0, 10000],
  swingBars: [1, 20],
  boxExtendBars: [0, 200],
  staleAfterSec: [3, 300],
  maxPriceAgeSec: [5, 3600],
};

export function sanitizeSettings(raw: unknown): AnalysisSettings {
  const src = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: AnalysisSettings = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(SETTING_RANGES) as NumericKey[]) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = SETTING_RANGES[key];
      out[key] = Math.min(max, Math.max(min, Math.round(v)));
    }
  }
  if (src.atrMethod === 'wilder' || src.atrMethod === 'sma') out.atrMethod = src.atrMethod;
  if (src.tpMode === 'latest' || src.tpMode === 'beyondEntry') out.tpMode = src.tpMode;
  if (src.slMode === 'prevCandle' || src.slMode === 'spike') out.slMode = src.slMode;
  return out;
}
