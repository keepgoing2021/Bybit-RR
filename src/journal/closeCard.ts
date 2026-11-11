import { CLOSE_RULE_LABEL, MOOD_LABEL, QUALITY_LABEL, tradeResult, type CloseRule, type Mood, type Trade } from '../core/journal';
import { h, setText } from '../ui/dom';
import type { Ctx } from './ctx';
import { fmtR, fmtTime, sign } from './format';

/** 하나만 고르는 칩 줄. 같은 칩을 다시 누르면 해제. 다시 그리지 않고 제자리에서 바뀐다(입력 중인 값이 안 날아가게) */
export function chipRow<T extends string>(name: string, labels: Record<T, string>, value: T | undefined, onPick: (v: T | undefined) => void, testid: string): HTMLElement {
  let cur = value;
  const keys = Object.keys(labels) as T[];
  const buttons = keys.map((k) => {
    const b = h('button', { type: 'button', class: 'j-chip', 'aria-pressed': String(k === cur), 'data-testid': `${testid}-${k}` }, labels[k]);
    b.addEventListener('click', () => {
      cur = cur === k ? undefined : k;
      buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(keys[i] === cur)));
      onPick(cur);
    });
    return b;
  });
  return h('div', { class: 'j-chips', role: 'group', 'aria-label': name }, h('span', { class: 'j-chips-name' }, name), ...buttons);
}

function card(ctx: Ctx, t: Trade, deleteBtn: (t: Trade) => HTMLElement): HTMLElement {
  const exit = h('input', { class: 'j-exit num', inputmode: 'decimal', placeholder: '청산가', 'aria-label': `${t.symbol} 청산가`, 'data-testid': `j-exit-${t.id}` });
  const preview = h('b', { class: 'j-preview num', 'data-testid': `j-preview-${t.id}` });
  const err = h('small', { class: 'j-err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'j-close', 'data-testid': `j-close-${t.id}` }, '저장');
  save.disabled = true;
  let rule: CloseRule | undefined;
  let mood: Mood | undefined;
  const price = () => {
    const raw = exit.value.replace(/[,\s]/g, '');
    const v = Number(raw);
    return raw !== '' && Number.isFinite(v) && v > 0 ? v : null;
  };
  const update = () => {
    const v = price();
    const res = v === null ? null : tradeResult({ ...t, exit: v });
    save.disabled = v === null;
    setText(err, v === null && exit.value.trim() !== '' ? '청산가를 숫자로 넣어 주세요' : '');
    setText(preview, res ? `결과 ${fmtR(res.r)}` : '');
    preview.dataset.sign = sign(res?.r ?? null);
  };
  const doClose = () => {
    const v = price();
    if (v === null) {
      update();
      return;
    }
    t.exit = v;
    t.closedAt = ctx.now();
    if (rule) t.closeRule = rule;
    if (mood) t.mood = mood;
    ctx.persist();
  };
  exit.addEventListener('input', update);
  exit.addEventListener('keydown', (e) => e.key === 'Enter' && doClose());
  save.addEventListener('click', doClose);
  // 손절·목표 자리 값을 칸에 채운다 (바로 청산하지 않는다 — 칩을 고를 틈)
  const quick = (label: string, p: number | null) => {
    if (p === null) return null;
    const b = h('button', { type: 'button', class: 'j-quick' }, label);
    b.addEventListener('click', () => {
      exit.value = String(p);
      update();
    });
    return b;
  };
  return h(
    'div',
    { class: 'j-open-row', 'data-testid': 'j-open-row' },
    h('div', { class: 'j-open-main' }, h('b', { 'data-side': t.side }, `${t.symbol.replace(/USDT$/, '')} ${t.side === 'LONG' ? '롱' : '숏'}`), h('span', { class: 'muted' }, `${fmtTime(t.openedAt)} · ${t.setup || '셋업 없음'} · ${QUALITY_LABEL[t.quality]}`)),
    h('div', { class: 'j-open-prices num' }, `진입 ${t.entry} · 손절 ${t.sl}${t.tp !== null ? ` · 목표 ${t.tp}` : ''}`),
    t.reason ? h('div', { class: 'j-reason' }, t.reason) : null,
    h('div', { class: 'j-open-actions' }, exit, quick('손절가로', t.sl), quick('목표가로', t.tp), preview),
    err,
    chipRow('규칙 지켰나', CLOSE_RULE_LABEL, undefined, (v) => (rule = v), `j-rule-${t.id}`),
    chipRow('그때 상태', MOOD_LABEL, undefined, (v) => (mood = v), `j-mood-${t.id}`),
    h('div', { class: 'j-open-actions' }, save, deleteBtn(t)),
  );
}

/** 진행 중인 거래 = 청산 카드 */
export function renderOpen(ctx: Ctx, deleteBtn: (t: Trade) => HTMLElement): HTMLElement {
  const open = ctx.journal.trades.filter((t) => t.exit === null).sort((a, b) => b.openedAt - a.openedAt);
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-open' },
    h('h2', {}, `진행 중 ${open.length}`),
    open.length ? h('div', { class: 'j-open' }, ...open.map((t) => card(ctx, t, deleteBtn))) : h('p', { class: 'muted' }, '계산기에서 LONG/SHORT 계산 후 「📒 저널에 기록」을 누르면 여기 나와요.'),
  );
}
