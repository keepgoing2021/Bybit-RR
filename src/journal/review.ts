import { REVIEW_MAX_CHARS, upsertReview } from '../core/journal';
import { currentFix, pendingReviewWeek, weekSummary } from '../core/journalInsights';
import { h } from '../ui/dom';
import type { Ctx } from './ctx';
import { fmtPct, fmtR } from './format';

/** 맨 위 한 칸: 안 쓴 지난 주 리뷰 카드, 아니면 「이번 주 고칠 것」 한 줄, 둘 다 아니면 없음 */
export function renderReview(ctx: Ctx): HTMLElement | null {
  const now = ctx.now();
  const week = pendingReviewWeek(ctx.journal, now);
  if (week === null) {
    const fix = currentFix(ctx.journal, now);
    return fix ? h('section', { class: 'j-section j-fix', 'data-testid': 'j-fix' }, h('span', { class: 'j-stat-label' }, '이번 주 고칠 것 하나'), h('b', {}, fix)) : null;
  }
  const s = weekSummary(ctx.journal.trades, week);
  const input = (id: string, label: string) => h('input', { type: 'text', maxlength: String(REVIEW_MAX_CHARS), placeholder: label, 'aria-label': label, 'data-testid': id, class: 'j-review-input' });
  const pattern = input('j-review-pattern', '반복된 패턴 한 줄');
  const fix = input('j-review-fix', '다음 주 고칠 것 하나');
  const save = h('button', { type: 'button', class: 'j-save', 'data-testid': 'j-review-save' }, '저장');
  save.disabled = true;
  const update = () => (save.disabled = pattern.value.trim() === '' && fix.value.trim() === '');
  pattern.addEventListener('input', update);
  fix.addEventListener('input', update);
  save.addEventListener('click', () => {
    if (save.disabled) return;
    upsertReview(ctx.journal, { weekStart: week, pattern: pattern.value.trim(), fix: fix.value.trim(), writtenAt: ctx.now() });
    ctx.persist();
  });
  return h(
    'section',
    { class: 'j-section j-review', 'data-testid': 'j-review' },
    h('h2', {}, '지난 주 돌아보기'),
    h('p', { class: 'num' }, `${s.trades}거래 · 승률 ${fmtPct(s.winRate)} · 합계 ${fmtR(s.totalR, 1)} · 규칙 준수 ${s.kept}/${s.trades}`),
    pattern,
    fix,
    save,
  );
}
