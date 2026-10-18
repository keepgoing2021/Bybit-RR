import type { AtrMethod } from './atr';
import type { TpMode } from './swing';

/** 확정된 전략이 아닌 MVP 초기 가정값. 설정 패널에서 바꿀 수 있다. */
export type SlMode = 'swing' | 'lowestN' | 'prevCandle' | 'spike';
export const SL_MODES: SlMode[] = ['swing', 'lowestN', 'prevCandle', 'spike'];

export interface AnalysisSettings {
  /**
   * SL 방식 (모두 LONG 기준, SHORT는 고가로 대칭)
   * swing(기본): 차트 시간봉의 최근 확정 스윙 저점 중 엔트리 아래 것
   * lowestN: 차트 시간봉 최근 N개 마감 봉 + 진행 중인 봉의 최저가
   * prevCandle: SL 기준 시간봉의 직전 마감 봉 저가
   * spike: 차트 시간봉의 가장 급격한 캔들 저가
   */
  slMode: SlMode;
  /** lowestN 방식의 탐색 범위 (마감 봉 수) */
  slLowestBars: number;
  /** 급격한 캔들 탐색 범위 (직전 확정 캔들 수) */
  lookback: number;
  atrPeriod: number;
  atrMethod: AtrMethod;
  /** SL 버퍼 (틱). LONG은 아래로, SHORT는 위로 더한다. */
  slBufferTicks: number;
  /** 스윙 판별 봉 수 (좌우 각각, SL 스윙과 TP 스윙 공통) */
  swingBars: number;
  tpMode: TpMode;
  /** 박스 오른쪽 끝: 최신 봉에서 몇 봉 앞까지 */
  boxExtendBars: number;
  /** 새 계산의 박스 시작: 진입 봉에서 오른쪽으로 몇 봉 (캔들을 가리지 않게) */
  boxOffsetBars: number;
  /** 이 시간 동안 웹소켓 메시지가 없으면 연결 지연(stale) */
  staleAfterSec: number;
  /** 최신 가격의 나이가 이보다 크면 시나리오 생성 차단 */
  maxPriceAgeSec: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  slMode: 'swing',
  slLowestBars: 20,
  lookback: 50,
  atrPeriod: 14,
  atrMethod: 'wilder',
  slBufferTicks: 0,
  swingBars: 2,
  tpMode: 'latest',
  boxExtendBars: 10,
  boxOffsetBars: 2,
  staleAfterSec: 15,
  maxPriceAgeSec: 60,
};

type NumericKey = Exclude<keyof AnalysisSettings, 'atrMethod' | 'tpMode' | 'slMode'>;

export const SETTING_RANGES: Record<NumericKey, [number, number]> = {
  slLowestBars: [1, 500],
  lookback: [5, 500],
  atrPeriod: [2, 200],
  slBufferTicks: [0, 10000],
  swingBars: [1, 20],
  boxExtendBars: [0, 200],
  boxOffsetBars: [0, 50],
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
  if ((SL_MODES as unknown[]).includes(src.slMode)) out.slMode = src.slMode as SlMode;
  return out;
}
