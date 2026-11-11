import { cumulativeR, weakestSpot } from '../core/journalInsights';
import { h } from '../ui/dom';
import type { Ctx } from './ctx';
import { fmtR, sign } from './format';

const SVG = 'http://www.w3.org/2000/svg';

/** 누적 R 곡선 + 가장 약한 곳 한 줄. 끝난 거래가 2개 미만이면 없음 */
export function renderCurve(ctx: Ctx): HTMLElement | null {
  const cum = cumulativeR(ctx.journal.trades);
  if (cum.length < 2) return null;
  const pts = [0, ...cum];
  const W = 300;
  const H = 60;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const y = (v: number) => (H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'j-curve');
  svg.setAttribute('data-testid', 'j-curve');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `누적 ${fmtR(cum[cum.length - 1])} (거래 ${cum.length}개)`);
  const zero = document.createElementNS(SVG, 'line');
  zero.setAttribute('x1', '0');
  zero.setAttribute('x2', String(W));
  zero.setAttribute('y1', y(0));
  zero.setAttribute('y2', y(0));
  zero.setAttribute('class', 'j-curve-zero');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${y(v)}`).join(' '));
  line.setAttribute('class', 'j-curve-line');
  line.setAttribute('data-sign', sign(cum[cum.length - 1]));
  svg.append(zero, line);
  const weak = weakestSpot(ctx.journal.trades);
  const box = h(
    'section',
    { class: 'j-section' },
    h('div', { class: 'j-cal-head' }, h('h2', {}, '누적 R'), h('b', { class: 'num', 'data-sign': sign(cum[cum.length - 1]) }, fmtR(cum[cum.length - 1]))),
  );
  box.append(svg);
  if (weak) box.append(h('p', { class: 'j-weak', 'data-testid': 'j-weak' }, '가장 약한 곳: ', h('b', { 'data-sign': 'down' }, `${weak.label} ${fmtR(weak.r, 1)}`)));
  return box;
}
