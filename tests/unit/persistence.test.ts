import { describe, expect, it } from 'vitest';
import {
  loadSettings, loadSizing, loadState, saveSettings, saveSizing, saveState, SETTINGS_KEY, SIZING_KEY, STATE_KEY, type PersistedState, type StorageLike,
} from '../../src/core/persistence';
import { setLevel } from '../../src/core/scenario';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { DEFAULT_SIZING } from '../../src/core/sizing';
import { makeScenario } from './helpers/scenario';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

const state = (): PersistedState => ({
  version: 1,
  scenario: setLevel(makeScenario(), 'sl', 97),
  ui: { provider: 'bybit', symbol: 'BTCUSDT', timeframe: '15' },
});

describe('state persistence', () => {
  it('roundtrip keeps the scenario including manual edits', () => {
    const st = memoryStorage();
    saveState(st, state());
    expect(loadState(st)).toEqual(state());
  });

  it('returns null when nothing is stored', () => {
    expect(loadState(memoryStorage())).toBeNull();
  });

  it('corrupt JSON returns null', () => {
    const st = memoryStorage();
    st.setItem(STATE_KEY, '{not json');
    expect(loadState(st)).toBeNull();
  });

  it('wrong version returns null', () => {
    const st = memoryStorage();
    st.setItem(STATE_KEY, JSON.stringify({ ...state(), version: 2 }));
    expect(loadState(st)).toBeNull();
  });

  it('drops a scenario with a broken shape but keeps the UI selection', () => {
    const st = memoryStorage();
    st.setItem(STATE_KEY, JSON.stringify({ ...state(), scenario: { id: 'x', entry: 'abc' } }));
    const loaded = loadState(st);
    expect(loaded?.scenario).toBeNull();
    expect(loaded?.ui?.symbol).toBe('BTCUSDT');
  });

  it('storage that throws', () => {
    expect(loadState(throwing)).toBeNull();
    expect(() => saveState(throwing, state())).not.toThrow();
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('settings persistence', () => {
  it('loadSettings sanitizes', () => {
    const st = memoryStorage();
    st.setItem(SETTINGS_KEY, JSON.stringify({ lookback: 9999, atrMethod: 'sma' }));
    const s = loadSettings(st);
    expect(s.lookback).toBe(500);
    expect(s.atrMethod).toBe('sma');
  });

  it('roundtrip', () => {
    const st = memoryStorage();
    saveSettings(st, { ...DEFAULT_SETTINGS, swingBars: 3 });
    expect(loadSettings(st).swingBars).toBe(3);
  });

  it('settings saved before the swing SL existed switch to the new default SL mode', () => {
    const st = memoryStorage();
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS, slMode: 'prevCandle', swingBars: 3 };
    delete old.slLowestBars;
    st.setItem(SETTINGS_KEY, JSON.stringify(old));
    const s = loadSettings(st);
    expect(s.slMode).toBe('swing');
    expect(s.swingBars).toBe(3);
  });

  it('a mode chosen after the change is kept', () => {
    const st = memoryStorage();
    saveSettings(st, { ...DEFAULT_SETTINGS, slMode: 'prevCandle' });
    expect(loadSettings(st).slMode).toBe('prevCandle');
  });
});

describe('saves from before TP 기준 was removed', () => {
  it('still load (htf in the UI selection and the scenario is ignored)', () => {
    const st = memoryStorage();
    const old = { ...state(), ui: { ...state().ui!, htf: '60' }, scenario: { ...state().scenario!, htf: '60' } };
    st.setItem(STATE_KEY, JSON.stringify(old));
    const loaded = loadState(st);
    expect(loaded?.ui?.symbol).toBe('BTCUSDT');
    expect(loaded?.scenario).not.toBeNull();
  });
});

describe('sizing persistence', () => {
  it('keeps capital, risk %, split count and weights; sanitizes garbage', () => {
    const st = memoryStorage();
    expect(loadSizing(st)).toEqual(DEFAULT_SIZING);
    saveSizing(st, { capital: 3000, riskPct: 2, splits: 5, weightMode: 'equalRisk', showAvgLine: false });
    expect(loadSizing(st)).toEqual({ capital: 3000, riskPct: 2, splits: 5, weightMode: 'equalRisk', showAvgLine: false });
    st.setItem(SIZING_KEY, '{bad json');
    expect(loadSizing(st)).toEqual(DEFAULT_SIZING);
    expect(loadSizing(throwing)).toEqual(DEFAULT_SIZING);
    expect(() => saveSizing(throwing, DEFAULT_SIZING)).not.toThrow();
  });
});

describe('box shift persistence', () => {
  it('keeps the box shift in bars and still accepts older saves (ms shift or none)', () => {
    const st = memoryStorage();
    saveState(st, { ...state(), scenario: { ...state().scenario!, boxShiftBars: 2 } });
    expect(loadState(st)?.scenario?.boxShiftBars).toBe(2);
    saveState(st, { ...state(), scenario: { ...state().scenario!, boxShiftMs: 900_000 } });
    expect(loadState(st)?.scenario?.boxShiftMs).toBe(900_000);
    const legacy = { ...state() };
    delete (legacy.scenario as { boxShiftMs?: number }).boxShiftMs;
    saveState(st, legacy);
    expect(loadState(st)?.scenario).not.toBeNull();
    saveState(st, { ...state(), scenario: { ...state().scenario!, boxShiftBars: -1 } });
    expect(loadState(st)?.scenario).toBeNull();
  });
});
