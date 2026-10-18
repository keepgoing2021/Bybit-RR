import { describe, expect, it } from 'vitest';
import { DragController } from '../../src/chart/drag';
import { computeBoxGeometry, type CoordMapper } from '../../src/chart/geometry';
import { computeMetrics } from '../../src/core/metrics';
import { snapToTick } from '../../src/core/price';
import { setLevel, type Scenario } from '../../src/core/scenario';
import { makeScenario } from './helpers/scenario';

const mapper: CoordMapper = { priceToY: (p) => (110 - p) * 10, logicalToX: (l) => l * 10 };
const yToPrice = (y: number) => 110 - y / 10;

function harness(initial: Scenario = makeScenario()) {
  let scenario = initial;
  const interaction: boolean[] = [];
  const drags: [string, number][] = [];
  const rrDuringDrag: (number | null)[] = [];
  const ctl = new DragController({
    getGeometry: () =>
      computeBoxGeometry(
        { side: scenario.side, entry: scenario.entry, sl: scenario.applied.sl, tp: scenario.applied.tp, startLogical: 10, endLogical: 20 },
        mapper,
      ),
    yToPrice,
    snap: (p) => snapToTick(p, scenario.tickSize),
    onDrag: (which, price) => {
      drags.push([which, price]);
      scenario = setLevel(scenario, which, price);
      rrDuringDrag.push(
        computeMetrics({ side: scenario.side, entry: scenario.entry, sl: scenario.applied.sl, tp: scenario.applied.tp, current: null, tickSize: scenario.tickSize }).rr,
      );
    },
    setChartInteraction: (on) => interaction.push(on),
  });
  return { ctl, interaction, drags, rrDuringDrag, scenario: () => scenario };
}

describe('DragController', () => {
  it('starting a drag on a line disables chart pan and zoom until release', () => {
    const h = harness();
    expect(h.ctl.pointerDown(150, 41)).toBe(true);
    expect(h.ctl.isDragging()).toBe(true);
    expect(h.interaction).toEqual([false]);
    h.ctl.pointerUp();
    expect(h.interaction).toEqual([false, true]);
    expect(h.ctl.isDragging()).toBe(false);
  });

  it('move reports the snapped price for the grabbed line', () => {
    const h = harness();
    h.ctl.pointerDown(150, 41);
    h.ctl.pointerMove(150, 29.996);
    expect(h.drags).toEqual([['tp', 107]]);
  });

  it('a press away from the lines leaves the chart alone', () => {
    const h = harness();
    expect(h.ctl.pointerDown(150, 70)).toBe(false);
    h.ctl.pointerMove(150, 60);
    h.ctl.pointerUp();
    expect(h.interaction).toEqual([]);
    expect(h.drags).toEqual([]);
  });

  it('drag updates RR in real time', () => {
    const h = harness();
    h.ctl.pointerDown(150, 120); // SL 선 (98)
    h.ctl.pointerMove(150, 125); // 97.5
    h.ctl.pointerMove(150, 130); // 97
    expect(h.rrDuringDrag).toEqual([2.4, 2]);
    expect(h.scenario().applied).toEqual({ sl: 97, tp: 106 });
    h.ctl.pointerUp();
    expect(h.scenario().entry).toBe(100);
  });

  it('dragging TP keeps SL', () => {
    const h = harness();
    h.ctl.pointerDown(150, 40);
    h.ctl.pointerMove(150, 10); // 109
    expect(h.scenario().applied).toEqual({ sl: 98, tp: 109 });
    expect(h.rrDuringDrag).toEqual([4.5]);
  });

  it('hover reports which line is under the pointer', () => {
    const h = harness();
    expect(h.ctl.hover(150, 121)).toBe('sl');
    expect(h.ctl.hover(150, 70)).toBeNull();
  });
});
