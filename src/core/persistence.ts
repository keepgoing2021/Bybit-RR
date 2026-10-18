import type { Scenario } from './scenario';
import { sanitizeSettings, type AnalysisSettings } from './settings';
import { TIMEFRAMES } from './timeframe';
import type { Timeframe } from './types';

export const STATE_KEY = 'rrtool.v1.state';
export const SETTINGS_KEY = 'rrtool.v1.settings';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UiSelection {
  provider: 'bybit' | 'demo';
  symbol: string;
  timeframe: Timeframe;
  htf: Timeframe | null;
}

export interface PersistedState {
  version: 1;
  scenario: Scenario | null;
  ui: UiSelection | null;
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
    return sanitizeSettings(raw === null ? null : JSON.parse(raw));
  } catch {
    return sanitizeSettings(null);
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
    (v.htf === null || isTf(v.htf))
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
    (v.htf === null || isTf(v.htf)) &&
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
    (closed === null || (isObject(closed) && isNum(closed.price) && isNum(closed.time)))
  );
}
