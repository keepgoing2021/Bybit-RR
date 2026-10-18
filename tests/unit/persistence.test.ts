import { describe, expect, it } from 'vitest';
import {
  loadSettings, loadState, saveSettings, saveState, SETTINGS_KEY, STATE_KEY, type PersistedState, type StorageLike,
} from '../../src/core/persistence';
import { setLevel } from '../../src/core/scenario';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
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
  ui: { provider: 'bybit', symbol: 'BTCUSDT', timeframe: '15', htf: '60' },
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
});
