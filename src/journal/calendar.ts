import { dailyTotals, lastDayKeys, monthCells } from '../core/journalInsights';
import { h } from '../ui/dom';
import type { Ctx } from './ctx';
import { fmtDay, fmtR } from './format';

export type CalView = 'strip' | 'month';
export interface CalState {
  view: CalView;
  month: { y: number; m0: number };
  /** 골라 본 날 */
  day: string | null;
}
export interface CalHandlers {
  view(v: CalView): void;
  month(y: number, m0: number): void;
  day(k: string | null): void;
}

/** 달력: 기본은 최근 4주 띠, 펼치면 한 달 */
export function renderCalendar(ctx: Ctx, state: CalState, on: CalHandlers): HTMLElement {
  const totals = dailyTotals(ctx.journal.trades);
  const cell = (key: string, big: boolean) => {
    const v = totals.get(key);
    const tone = !v ? '' : v.r > 0 ? 'w' : v.r < 0 ? 'l' : 'e';
    const label = v ? `${fmtDay(key)} ${fmtR(v.r, 1)} · ${v.n}거래` : `${fmtDay(key)} 거래 없음`;
    const b = h(
      'button',
      { type: 'button', class: big ? 'j-day' : 'j-strip-day', 'data-tone': tone, title: label, 'aria-label': label, 'aria-pressed': String(state.day === key), ...(big ? { 'data-testid': `j-day-${key}` } : {}) },
      ...(big ? [h('span', {}, String(Number(key.slice(8, 10)))), v ? h('b', { class: 'num' }, fmtR(v.r, 1)) : null] : [v ? (v.r > 0 ? '+' : v.r < 0 ? '−' : '·') : '']),
    );
    b.disabled = !v;
    b.addEventListener('click', () => on.day(state.day === key ? null : key));
    return b;
  };
  const toggle = h('button', { type: 'button', class: 'link', 'data-testid': 'j-cal-toggle' }, state.view === 'strip' ? '달력 전체 보기 ›' : '4주만 보기');
  toggle.addEventListener('click', () => on.view(state.view === 'strip' ? 'month' : 'strip'));
  if (state.view === 'strip') {
    return h(
      'section',
      { class: 'j-section j-cal-box' },
      h('div', { class: 'j-cal-head' }, h('h2', {}, '최근 4주'), toggle),
      h('div', { class: 'j-strip', 'data-testid': 'j-strip' }, ...lastDayKeys(ctx.now(), 28).map((k) => cell(k, false))),
    );
  }
  const { y, m0 } = state.month;
  const nav = (label: string, delta: number, name: string) => {
    const b = h('button', { type: 'button', class: 'j-quick', 'aria-label': name }, label);
    b.addEventListener('click', () => {
      const d = new Date(Date.UTC(y, m0 + delta, 1));
      on.month(d.getUTCFullYear(), d.getUTCMonth());
    });
    return b;
  };
  const cells = monthCells(y, m0);
  const monthR = cells.reduce((a, k) => a + ((k && totals.get(k)?.r) || 0), 0);
  return h(
    'section',
    { class: 'j-section j-cal-box' },
    h('div', { class: 'j-cal-head' }, h('h2', {}, `${y}년 ${m0 + 1}월`), h('span', { class: 'muted small num' }, `합계 ${fmtR(monthR, 1)}`), nav('‹', -1, '이전 달'), nav('›', 1, '다음 달'), toggle),
    h(
      'div',
      { class: 'j-cal', 'data-testid': 'j-cal' },
      ...[...'일월화수목금토'].map((w) => h('span', { class: 'j-cal-dow' }, w)),
      ...cells.map((k) => (k === null ? h('span', {}) : cell(k, true))),
    ),
  );
}
