import { describe, expect, it } from 'vitest';
import { loadState, safeStorage, saveState, type StorageLike } from '../../src/core/persistence';

describe('safeStorage', () => {
  it('falls back to in-memory storage when touching localStorage throws', () => {
    const st = safeStorage(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    st.setItem('k', 'v');
    expect(st.getItem('k')).toBe('v');
    saveState(st, { version: 1, scenario: null, ui: null });
    expect(loadState(st)).toEqual({ version: 1, scenario: null, ui: null });
  });

  it('returns the real storage when it is available', () => {
    const real: StorageLike = { getItem: () => 'x', setItem: () => {}, removeItem: () => {} };
    expect(safeStorage(() => real)).toBe(real);
  });
});
