import { periodStart } from '../core/journal';
import { recordStreak, score, SCORE_MIN_TRADES, weekSummary } from '../core/journalInsights';
import { h } from '../ui/dom';
import type { Ctx } from './ctx';
import { fmtR, sign } from './format';

/** 숫자 3개: 점수 · 연속 기록 · 이번 주 R */
export function renderNumbers(ctx: Ctx): HTMLElement {
  const now = ctx.now();
  const s = score(ctx.journal.trades, now);
  const streak = recordStreak(ctx.journal.trades);
  const week = weekSummary(ctx.journal.trades, periodStart(now, 'week'));
  const box = (id: string, label: string, value: string, sub: string, tone = '') =>
    h('div', { class: 'j-num', 'data-testid': id, 'data-tone': tone }, h('span', { class: 'j-stat-label' }, label), h('b', { class: 'j-num-value num' }, value), h('span', { class: 'j-stat-sub' }, sub));
  return h(
    'section',
    { class: 'j-nums', 'aria-label': '요약 숫자' },
    s
      ? box('j-score', '점수', String(s.total), `수익 ${Math.round(s.profit)} · 규칙 ${Math.round(s.rules)} · 손실 관리 ${Math.round(s.loss)} · 꾸준함 ${Math.round(s.consistency)}`)
      : box('j-score', '점수', '—', `최근 30일 거래 ${SCORE_MIN_TRADES}개부터`),
    box('j-streak', '연속 기록', `${streak}일`, '칩 두 줄을 다 채운 거래일'),
    box('j-week-r', '이번 주', fmtR(week.totalR, 1), `${week.trades}거래`, sign(week.totalR)),
  );
}
