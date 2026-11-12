import { CLOSE_RULE_LABEL, MOOD_LABEL, QUALITY_LABEL, REASON_MAX_CHARS, tradeResult, type CloseRule, type Mood, type Quality, type Trade } from '../core/journal';
import { h, setText } from '../ui/dom';
import type { Ctx } from './ctx';
import { fmtElapsed, fmtR, fmtTime, sign } from './format';

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

/**
 * 셋업 · 진입 규칙 · 근거를 나중에 적는 칸 (2026-11-12).
 * 「진입 기록」은 아무것도 묻지 않고 한 번에 끝나니, 이 셋은 매매일지에서 적는다 (진행 중 카드와 거래 목록 둘 다).
 * 누르는 즉시 저장하고 다시 그리지 않는다. onChange로 바깥 표시(줄의 셋업·근거 칸)를 고친다.
 */
export function noteEditor(ctx: Ctx, t: Trade, onChange: () => void): HTMLElement {
  const done = () => {
    ctx.save();
    onChange();
  };
  // 셋업: 설정의 목록 + (목록에서 지운 뒤에도) 이 거래에 적혀 있던 이름
  const names = [...new Set([...ctx.journal.settings.setups, ...(t.setup ? [t.setup] : [])])];
  const setups = names.length
    ? chipRow('셋업', Object.fromEntries(names.map((n) => [n, n])) as Record<string, string>, t.setup || undefined, (v) => {
        t.setup = v ?? '';
        done();
      }, `j-setup-${t.id}`)
    : h('p', { class: 'muted small' }, '셋업 목록이 비어 있어요. 「설정」 탭에서 추가해 주세요.');
  // 품질: 셋 중 하나는 늘 골라져 있다
  const qKeys = Object.keys(QUALITY_LABEL) as Quality[];
  const qButtons = qKeys.map((k) => {
    const b = h('button', { type: 'button', class: 'j-chip', 'aria-pressed': String(t.quality === k), 'data-testid': `j-quality-${t.id}-${k}` }, QUALITY_LABEL[k]);
    b.addEventListener('click', () => {
      t.quality = k;
      qButtons.forEach((x, i) => x.setAttribute('aria-pressed', String(qKeys[i] === k)));
      done();
    });
    return b;
  });
  const quality = h('div', { class: 'j-chips', role: 'group', 'aria-label': '품질' }, h('span', { class: 'j-chips-name' }, '품질'), ...qButtons);
  // 진입 규칙: 여러 개 체크
  const ruleNames = [...new Set([...ctx.journal.settings.rules, ...t.rules])];
  const ruleButtons = ruleNames.map((name, i) => {
    const b = h('button', { type: 'button', class: 'j-chip', 'aria-pressed': String(t.rules.includes(name)), 'data-testid': `j-erule-${t.id}-${i}` }, name);
    b.addEventListener('click', () => {
      t.rules = t.rules.includes(name) ? t.rules.filter((x) => x !== name) : [...t.rules, name];
      b.setAttribute('aria-pressed', String(t.rules.includes(name)));
      done();
    });
    return b;
  });
  const rules = ruleNames.length ? h('div', { class: 'j-chips', role: 'group', 'aria-label': '지킨 진입 규칙' }, h('span', { class: 'j-chips-name' }, '지킨 진입 규칙 (여러 개)'), ...ruleButtons) : null;
  // 근거: 글 상자 + 저장 버튼 (칸을 벗어나기만 해도 저장)
  const area = h('textarea', { class: 'j-reason-input', rows: '2', maxlength: String(REASON_MAX_CHARS), placeholder: '왜 들어갔나요? (예: 4시간 지지에서 스윕 후 반등)', 'aria-label': `${t.symbol} 진입 근거`, 'data-testid': `j-reason-${t.id}` }, t.reason);
  const state = h('small', { class: 'j-reason-state', role: 'status', 'data-testid': `j-reason-state-${t.id}` });
  const save = h('button', { type: 'button', class: 'j-quick', 'data-testid': `j-reason-save-${t.id}` }, '근거 저장');
  const saveReason = () => {
    const v = area.value.trim().slice(0, REASON_MAX_CHARS);
    if (v === t.reason) {
      if (area.value !== v) area.value = v;
      return;
    }
    t.reason = v;
    area.value = v;
    const ok = ctx.save();
    setText(state, ok ? '저장됨' : '');
    onChange();
  };
  area.addEventListener('input', () => setText(state, area.value.trim() === t.reason ? '' : `${area.value.length} / ${REASON_MAX_CHARS}`));
  area.addEventListener('change', saveReason);
  save.addEventListener('click', () => {
    saveReason();
    setText(state, '저장됨');
  });
  return h('div', { class: 'j-note' }, setups, quality, rules, h('div', { class: 'j-reason-edit' }, h('span', { class: 'j-chips-name' }, '진입 근거'), area, h('div', { class: 'j-reason-actions' }, save, state)));
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
  // 손절·목표에 닿기 전에 정리할 때: 지금 시세를 칸에 채운다 (저장은 직접)
  const nowBtn = h('button', { type: 'button', class: 'j-quick', 'data-testid': `j-now-${t.id}` }, '지금 가격으로');
  nowBtn.addEventListener('click', () => {
    nowBtn.disabled = true;
    void ctx.lastPrice(t.symbol).then((p) => {
      nowBtn.disabled = false;
      if (p === null) {
        ctx.toast('지금 가격을 받지 못했어요. 청산가를 직접 넣어 주세요.');
        return;
      }
      exit.value = String(p);
      update();
    });
  });
  // 셋업 · 근거는 접어 둔다 (적으면 위 줄에 바로 보인다)
  const meta = h('span', { class: 'muted' });
  const reasonLine = h('div', { class: 'j-reason' });
  const noteSummary = h('summary', {});
  const showNote = () => {
    setText(meta, `${fmtTime(t.openedAt)} · ${t.setup || '셋업 없음'} · ${QUALITY_LABEL[t.quality]}`);
    setText(reasonLine, t.reason);
    reasonLine.hidden = !t.reason;
    setText(noteSummary, t.setup || t.reason ? '셋업 · 근거 고치기' : '＋ 셋업 · 근거 쓰기');
  };
  showNote();
  const notes = h('details', { class: 'j-notes', 'data-testid': `j-notes-${t.id}` }, noteSummary, noteEditor(ctx, t, showNote));
  return h(
    'div',
    { class: 'j-open-row', 'data-testid': 'j-open-row' },
    h('div', { class: 'j-open-main' }, h('b', { 'data-side': t.side }, `${t.symbol.replace(/USDT$/, '')} ${t.side === 'LONG' ? '롱' : '숏'}`), meta, h('span', { class: 'j-elapsed num', 'data-testid': `j-elapsed-${t.id}`, 'data-opened': String(t.openedAt), title: '진입 후 지난 시간' }, `⏱ ${fmtElapsed(ctx.now() - t.openedAt)}`)),
    h('div', { class: 'j-open-prices num' }, `진입 ${t.entry} · 손절 ${t.sl}${t.tp !== null ? ` · 목표 ${t.tp}` : ''}`),
    reasonLine,
    h('div', { class: 'j-open-actions' }, exit, nowBtn, quick('손절가로', t.sl), quick('목표가로', t.tp), preview),
    err,
    chipRow('규칙 지켰나', CLOSE_RULE_LABEL, undefined, (v) => (rule = v), `j-rule-${t.id}`),
    chipRow('그때 상태', MOOD_LABEL, undefined, (v) => (mood = v), `j-mood-${t.id}`),
    notes,
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
    open.length
      ? h('div', { class: 'j-open' }, ...open.map((t) => card(ctx, t, deleteBtn)), h('p', { class: 'muted small' }, '손절·목표에 닿으면 자동으로 청산돼요 (가상 체결 · Bybit 1분 캔들 기준, 실제 체결가와 다를 수 있어요).'))
      : h('p', { class: 'muted' }, '계산기 차트에서 LONG/SHORT 계산 후 아래쪽 「진입 기록」을 누르면 여기 나와요.'),
  );
}
