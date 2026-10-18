import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../../src/core/metrics';
import { closeScenario, restoreAuto, setBoxShift, setLevel, type Scenario } from '../../src/core/scenario';
import { makeScenario } from './helpers/scenario';

const rrOf = (s: Scenario) =>
  computeMetrics({ side: s.side, entry: s.entry, sl: s.applied.sl, tp: s.applied.tp, current: null, tickSize: s.tickSize }).rr;

describe('createScenario', () => {
  it('create applies auto prices and marks auto', () => {
    const s = makeScenario();
    expect(s.applied).toEqual({ sl: 98, tp: 106 });
    expect(s.source).toEqual({ sl: 'auto', tp: 'auto' });
    expect(s.status).toBe('active');
    expect(s.entry).toBe(100);
    expect(s.priceTime).toBe(1_000);
    expect(s.clickedAt).toBe(1_200);
  });

  it('leaves an invalid auto level empty for manual completion', () => {
    const s = makeScenario(null, 106);
    expect(s.applied.sl).toBeNull();
  });
});

describe('setLevel', () => {
  it('setLevel sl keeps entry and tp, marks manual, snaps', () => {
    const s = setLevel(makeScenario(), 'sl', 97.004);
    expect(s.applied).toEqual({ sl: 97, tp: 106 });
    expect(s.source).toEqual({ sl: 'manual', tp: 'auto' });
    expect(s.entry).toBe(100);
  });

  it('setLevel tp keeps entry and sl', () => {
    const s = setLevel(makeScenario(), 'tp', 109);
    expect(s.applied).toEqual({ sl: 98, tp: 109 });
    expect(s.source.tp).toBe('manual');
  });

  it('marks manual even when the value equals the auto value', () => {
    expect(setLevel(makeScenario(), 'sl', 98).source.sl).toBe('manual');
  });

  it('spec example flow', () => {
    let s = makeScenario();
    expect(rrOf(s)).toBe(3);
    s = setLevel(s, 'sl', 97);
    expect(s.applied.tp).toBe(106);
    expect(rrOf(s)).toBe(2);
    s = setLevel(s, 'tp', 109);
    expect(s.applied.sl).toBe(97);
    expect(rrOf(s)).toBe(3);
  });

  it('does not mutate the previous scenario object', () => {
    const before = makeScenario();
    setLevel(before, 'sl', 90);
    expect(before.applied.sl).toBe(98);
  });
});

describe('restoreAuto', () => {
  it('restoreAuto returns creation-time auto values and keeps entry', () => {
    const edited = setLevel(setLevel(makeScenario(), 'sl', 95), 'tp', 120);
    const r = restoreAuto(edited);
    expect(r.applied).toEqual({ sl: 98, tp: 106 });
    expect(r.source).toEqual({ sl: 'auto', tp: 'auto' });
    expect(r.entry).toBe(100);
    expect(r.auto).toEqual(edited.auto);
  });
});

describe('closeScenario', () => {
  it('close freezes', () => {
    const closed = closeScenario(makeScenario(), { price: 103, time: 5_000 });
    expect(closed.status).toBe('closed');
    expect(closed.closed).toEqual({ price: 103, time: 5_000 });
    expect(setLevel(closed, 'sl', 90)).toBe(closed);
    expect(restoreAuto(closed)).toBe(closed);
    expect(closeScenario(closed, { price: 1, time: 1 })).toBe(closed);
  });
});

describe('setBoxShift', () => {
  it('moves only where the box is drawn', () => {
    const s = setBoxShift(makeScenario(), 45 * 60_000);
    expect(s.boxShiftMs).toBe(45 * 60_000);
    expect(s.entry).toBe(100);
    expect(s.applied).toEqual({ sl: 98, tp: 106 });
    expect(s.source).toEqual({ sl: 'auto', tp: 'auto' });
  });

  it('never goes left of the entry time', () => {
    expect(setBoxShift(makeScenario(), -5).boxShiftMs).toBe(0);
  });

  it('also works on a closed scenario', () => {
    const closed = closeScenario(makeScenario(), { price: 103, time: 5_000 });
    expect(setBoxShift(closed, 1_000).boxShiftMs).toBe(1_000);
  });
});
