import type { Scenario } from './scenario';
import { sanitizeSettings, type AnalysisSettings } from './settings';
import { sanitizeSizing, type SizingSettings } from './sizing';
import { sanitizeDrawings, type Drawing } from './drawings';
import { TIMEFRAMES } from './timeframe';
import type { Timeframe } from './types';

export const STATE_KEY = 'rrtool.v1.state';
export const SETTINGS_KEY = 'rrtool.v1.settings';
export const SIZING_KEY = 'rrtool.v1.sizing';
export const DRAWINGS_KEY = 'rrtool.v1.drawings';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UiSelection {
  provider: 'bybit' | 'demo';
  symbol: string;
  timeframe: Timeframe;
  /** 이전 버전의 TP 기준 (쓰지 않음) */
  htf?: Timeframe | null;
  /** SL 기준 시간봉 (없으면 차트 시간봉 기준 기본값) */
  slTf?: Timeframe;
}

export interface PersistedState {
  version: 1;
  scenario: Scenario | null;
  ui: UiSelection | null;
}

/**
 * 브라우저 저장소 접근 자체가 예외를 던지는 환경(저장소 차단 등)에서는
 * 이 탭에서만 유지되는 메모리 저장소로 대신한다.
 */
export function safeStorage(get: () => StorageLike): StorageLike {
  try {
    const s = get();
    if (s) return s;
  } catch {
    // 아래 메모리 저장소 사용
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

export function saveState(storage: StorageLike, state: PersistedState): void {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 저장을 건너뛴다.
  }
}

export function loadState(storage: StorageLike): PersistedState | null {
  let parsed: unknown;
  try {
    const raw = storage.getItem(STATE_KEY);
    if (raw === null) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.version !== 1) return null;
  return {
    version: 1,
    scenario: isScenario(parsed.scenario) ? (parsed.scenario as Scenario) : null,
    ui: isUiSelection(parsed.ui) ? (parsed.ui as UiSelection) : null,
  };
}

export function saveSettings(storage: StorageLike, settings: AnalysisSettings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 무시
  }
}

export function loadSettings(storage: StorageLike): AnalysisSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    // 스윙 SL(slLowestBars와 함께 추가)이 생기기 전에 저장된 설정의 SL 방식은 그때의 기본값이라 새 기본값으로 바꾼다
    if (isObject(parsed) && !('slLowestBars' in parsed)) delete parsed.slMode;
    return sanitizeSettings(parsed);
  } catch {
    return sanitizeSettings(null);
  }
}

/** 분할 진입 계산 입력 (운영자산 등). 이 브라우저에만 저장된다 */
export function saveSizing(storage: StorageLike, sizing: SizingSettings): void {
  try {
    storage.setItem(SIZING_KEY, JSON.stringify(sizing));
  } catch {
    // 무시
  }
}

export function loadSizing(storage: StorageLike): SizingSettings {
  try {
    const raw = storage.getItem(SIZING_KEY);
    return sanitizeSizing(raw === null ? null : JSON.parse(raw));
  } catch {
    return sanitizeSizing(null);
  }
}

/** 작도 { 종목: Drawing[] }. 이 브라우저에만 저장된다 */
export function saveDrawings(storage: StorageLike, all: Record<string, Drawing[]>): void {
  try {
    storage.setItem(DRAWINGS_KEY, JSON.stringify(all));
  } catch {
    // 무시
  }
}

export function loadDrawings(storage: StorageLike): Record<string, Drawing[]> {
  try {
    const raw = storage.getItem(DRAWINGS_KEY);
    return sanitizeDrawings(raw === null ? null : JSON.parse(raw));
  } catch {
    return {};
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);
const isTf = (v: unknown): v is Timeframe => typeof v === 'string' && (TIMEFRAMES as string[]).includes(v);
const isSource = (v: unknown) => v === 'auto' || v === 'manual';

function isUiSelection(v: unknown): boolean {
  return (
    isObject(v) &&
    (v.provider === 'bybit' || v.provider === 'demo') &&
    typeof v.symbol === 'string' &&
    isTf(v.timeframe) &&
    (v.htf === undefined || v.htf === null || isTf(v.htf)) &&
    (v.slTf === undefined || isTf(v.slTf))
  );
}

function isScenario(v: unknown): boolean {
  if (!isObject(v)) return false;
  const { applied, source, auto, closed } = v;
  return (
    v.version === 1 &&
    typeof v.id === 'string' &&
    typeof v.symbol === 'string' &&
    isTf(v.timeframe) &&
    (v.htf === undefined || v.htf === null || isTf(v.htf)) &&
    (v.side === 'LONG' || v.side === 'SHORT') &&
    isNum(v.entry) &&
    isNum(v.tickSize) &&
    (v.tickSize as number) > 0 &&
    isNum(v.clickedAt) &&
    isNum(v.priceTime) &&
    isObject(applied) &&
    isNumOrNull(applied.sl) &&
    isNumOrNull(applied.tp) &&
    isObject(source) &&
    isSource(source.sl) &&
    isSource(source.tp) &&
    isObject(auto) &&
    isObject(auto.sl) &&
    isObject(auto.tp) &&
    isNumOrNull(auto.sl.price) &&
    isNumOrNull(auto.tp.price) &&
    isObject(v.settings) &&
    (v.status === 'active' || v.status === 'closed') &&
    (closed === null || (isObject(closed) && isNum(closed.price) && isNum(closed.time))) &&
    (v.boxShiftMs === undefined || (isNum(v.boxShiftMs) && v.boxShiftMs >= 0)) &&
    (v.boxShiftBars === undefined || (isNum(v.boxShiftBars) && v.boxShiftBars >= 0))
  );
}
