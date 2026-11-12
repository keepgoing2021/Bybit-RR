import { DEFAULT_JOURNAL_SETTINGS, MAX_RULES, type JournalSettings } from '../core/journal';
import {
  addItem, autoRiskExample, dailyStatus, ITEM_MAX_CHARS, LIMIT_PRESETS, limitRows, MAX_SETUPS, presetOf, removeItem, renameItem, stepValue,
  type ListEdit, type StepRange,
} from '../core/journalSettings';
import { h } from '../ui/dom';
import type { Ctx } from './ctx';
import { fmtR } from './format';

/**
 * 매매일지 「설정」 (2026-11-12 개편, 사용자: "너무 허접하고 사용 편의성이 꽝").
 * - 저장 버튼 없음: 바꾸는 즉시 저장하고 「✓ 저장됨」을 띄운다 (계산기에도 바로 적용)
 * - 숫자는 − / + 버튼과 단위, 「0 = 끔」 대신 스위치
 * - 지금 상태(오늘 몇 번 · 한도까지 얼마)를 옆에 같이
 * - 목록은 칩: 추가 · 지우기(되돌리기) · 눌러서 이름 바꾸기 — 키보드 Enter 없이 버튼만으로 된다
 */
export interface SettingsDeps {
  /** 저장소에 쓴다 (다시 그리지는 않는다). 실패하면 false */
  save(): boolean;
  /** 계산기에 넣어 둔 총 자산 (없으면 null) */
  capital: number | null;
  backup: HTMLElement;
  restore: HTMLElement;
  csv: HTMLElement;
  /** '3일 전 백업' 같은 글 (백업한 적 없으면 null) */
  backupAge: string | null;
}

type SectionKey = 'rules' | 'lists' | 'risk' | 'data';
const SECTIONS: [SectionKey, string][] = [['rules', '거래 규칙'], ['lists', '셋업·체크리스트'], ['risk', '위험 자동 조절'], ['data', '백업·내보내기']];
type ListKey = 'setups' | 'rules';

const R_MAX_TRADES: StepRange = { step: 1, min: 1, max: 50 };
const R_STOP: StepRange = { step: 1, min: 1, max: 20 };
const R_LIMIT: StepRange = { step: 0.5, min: 0, max: 100 };
const R_RISK: StepRange = { step: 0.1, min: 0.1, max: 10 };
const R_THRESHOLD: StepRange = { step: 0.5, min: 0, max: 100 };

// 화면 상태 (이 탭을 여는 동안만)
let active: SectionKey = 'rules';
let pendingScroll: SectionKey | null = null;
let flash: { text: string; undo?: () => void } | null = null;
let editing: { list: ListKey; index: number } | null = null;
let listError: { list: ListKey; text: string } | null = null;
/** 스위치를 껐다 켤 때 되살릴 값 */
const lastOn = { max: DEFAULT_JOURNAL_SETTINGS.daily.maxTradesPerDay, stop: DEFAULT_JOURNAL_SETTINGS.daily.stopAfterLosses };

/** 다음에 설정을 그릴 때 그 묶음으로 스크롤한다 (머리글의 백업 안내를 눌렀을 때) */
export function openSettingsSection(key: SectionKey): void {
  active = key;
  pendingScroll = key;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);

export function renderSettings(ctx: Ctx, deps: SettingsDeps): HTMLElement {
  let current = build();

  function redraw(focusKey?: string): void {
    const next = build();
    current.replaceWith(next);
    current = next;
    if (focusKey) next.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  /** 설정을 바꾸고 바로 저장한다 */
  function commit(change: (s: JournalSettings) => void, focusKey?: string, note?: { text: string; undo?: () => void }): void {
    change(ctx.journal.settings);
    if (!deps.save()) {
      flash = null;
      ctx.toast('저장하지 못했어요 (브라우저 저장소가 막혀 있어요).');
    } else flash = note ?? { text: '✓ 저장됨 · 계산기에 바로 적용' };
    redraw(focusKey);
  }

  function stepper(key: string, value: number, range: StepRange, unit: string, set: (v: number) => void, opts: { disabled?: boolean; offAtZero?: boolean; label: string }): HTMLElement {
    const off = opts.offAtZero && value === 0;
    const go = (v: number, focus: string) => {
      if (v !== value) set(v);
      else redraw(focus);
    };
    const minus = h('button', { type: 'button', class: 'js-step-btn', 'data-key': `${key}-minus`, 'data-testid': `j-set-${key}-minus`, 'aria-label': `${opts.label} 줄이기`, disabled: opts.disabled || value <= range.min }, '−');
    const plus = h('button', { type: 'button', class: 'js-step-btn', 'data-key': `${key}-plus`, 'data-testid': `j-set-${key}-plus`, 'aria-label': `${opts.label} 늘리기`, disabled: opts.disabled || value >= range.max }, '+');
    const input = h('input', {
      type: 'text', inputmode: 'decimal', class: 'js-step-input num', value: off ? '끔' : num(value), 'data-key': `${key}-input`, 'data-testid': `j-set-${key}`,
      'aria-label': `${opts.label} (${unit})`, disabled: opts.disabled,
    });
    minus.addEventListener('click', () => go(stepValue(value, -1, range), plus.disabled ? `${key}-minus` : `${key}-minus`));
    plus.addEventListener('click', () => go(stepValue(value, 1, range), `${key}-plus`));
    input.addEventListener('focus', () => {
      if (off) input.value = '0';
      input.select();
    });
    input.addEventListener('change', () => go(stepValue(Number(input.value.replace(',', '.')), 0, range, value), `${key}-input`));
    return h('span', { class: 'js-step', 'data-off': String(!!opts.disabled) }, minus, h('span', { class: 'js-step-val' }, input, off ? null : h('i', {}, unit)), plus);
  }

  function toggle(key: string, on: boolean, label: string, set: (on: boolean) => void): HTMLElement {
    const b = h('button', { type: 'button', role: 'switch', class: 'js-switch', 'aria-checked': String(on), 'aria-label': label, 'data-key': key, 'data-testid': `j-set-${key}` }, h('span', {}));
    b.addEventListener('click', () => set(!on));
    return b;
  }

  function card(section: SectionKey, title: string, desc: string, extra: HTMLElement | null, ...body: (HTMLElement | null)[]): HTMLElement {
    return h('div', { class: 'js-card', 'data-section': section }, h('div', { class: 'js-card-head' }, h('h3', {}, title), extra), h('p', { class: 'js-desc' }, desc), ...body);
  }

  function row(title: string, sub: string, ...controls: HTMLElement[]): HTMLElement {
    return h('div', { class: 'js-row' }, h('div', { class: 'js-row-text' }, h('b', {}, title), sub ? h('small', {}, sub) : null), h('div', { class: 'js-row-ctl' }, ...controls));
  }

  function dailyCard(s: JournalSettings): HTMLElement {
    const st = dailyStatus(ctx.journal, ctx.now());
    const maxOn = s.daily.maxTradesPerDay > 0;
    const stopOn = s.daily.stopAfterLosses > 0;
    if (maxOn) lastOn.max = s.daily.maxTradesPerDay;
    if (stopOn) lastOn.stop = s.daily.stopAfterLosses;
    return card(
      'rules', '하루 운영 규칙', '넘으면 계산기 위쪽에 경고가 떠요.', null,
      row(
        '하루 최대 거래 수', maxOn ? `오늘 ${st.openedToday}회 했어요` : '꺼져 있어요',
        stepper('max', maxOn ? s.daily.maxTradesPerDay : lastOn.max, R_MAX_TRADES, '회', (v) => commit((x) => (x.daily.maxTradesPerDay = v), undefined), { disabled: !maxOn, label: '하루 최대 거래 수' }),
        toggle('max-on', maxOn, '하루 최대 거래 수 규칙 켜기', (on) => commit((x) => (x.daily.maxTradesPerDay = on ? lastOn.max : 0), 'max-on')),
      ),
      row(
        '연속 손절이면 그날 중단', stopOn ? `지금 연속 ${st.lossStreak}번` : '꺼져 있어요',
        stepper('stop', stopOn ? s.daily.stopAfterLosses : lastOn.stop, R_STOP, '번', (v) => commit((x) => (x.daily.stopAfterLosses = v), undefined), { disabled: !stopOn, label: '연속 손절 중단 횟수' }),
        toggle('stop-on', stopOn, '연속 손절 중단 규칙 켜기', (on) => commit((x) => (x.daily.stopAfterLosses = on ? lastOn.stop : 0), 'stop-on')),
      ),
    );
  }

  function limitsCard(s: JournalSettings): HTMLElement {
    const preset = presetOf(s.limits);
    const presets = h(
      'div',
      { class: 'js-presets', role: 'group', 'aria-label': '손실 한도 한 번에 고르기' },
      ...LIMIT_PRESETS.map((p) => {
        const b = h(
          'button',
          { type: 'button', class: 'js-preset', 'aria-pressed': String(preset === p.key), 'data-key': `preset-${p.key}`, 'data-testid': `j-set-preset-${p.key}` },
          p.label, h('small', {}, ` ${p.limits.daily}·${p.limits.weekly}·${p.limits.monthly}`),
        );
        b.addEventListener('click', () => commit((x) => (x.limits = { ...p.limits }), `preset-${p.key}`));
        return b;
      }),
    );
    const names = { day: ['하루', '오늘', 'daily'], week: ['한 주', '이번 주', 'weekly'], month: ['한 달', '이번 달', 'monthly'] } as const;
    const rows = limitRows(ctx.journal, ctx.now()).map((r) => {
      const [title, nowLabel, field] = names[r.period];
      const status = r.off ? '꺼져 있어요 (0)' : `${nowLabel} ${fmtR(r.r, 1)} / −${num(r.limit)}R${r.ratio >= 1 ? ' · 한도 넘음' : ''}`;
      return h(
        'div',
        { class: 'js-row' },
        h(
          'div',
          { class: 'js-row-text js-row-grow' },
          h('b', {}, title),
          h('div', { class: 'js-bar', 'data-full': String(r.ratio >= 1), role: 'img', 'aria-label': `한도의 ${Math.round(r.ratio * 100)}% 사용` }, h('i', { style: `width:${Math.round(r.ratio * 100)}%` })),
          h('small', { 'data-testid': `j-set-limit-${r.period}-now` }, status),
        ),
        h('div', { class: 'js-row-ctl' }, stepper(`limit-${r.period}`, r.limit, R_LIMIT, 'R', (v) => commit((x) => (x.limits[field] = v), undefined), { offAtZero: true, label: `${title} 손실 한도` })),
      );
    });
    return card('rules', '손실 한도', '여기까지 잃으면 그 기간은 쉬라고 알려줘요. R = 한 번에 거는 위험.', null, presets, ...rows);
  }

  function listCard(list: ListKey, title: string, desc: string, max: number, placeholder: string): HTMLElement {
    const items = ctx.journal.settings[list];
    const apply = (r: ListEdit, focusKey: string, note?: { text: string; undo?: () => void }) => {
      if (!r.ok) {
        listError = { list, text: r.reason };
        redraw(focusKey);
        return;
      }
      listError = null;
      editing = null;
      const next = r.list;
      commit((x) => (x[list] = next), focusKey, note);
    };
    const chips = items.map((name, i) => {
      if (editing && editing.list === list && editing.index === i) {
        const input = h('input', { type: 'text', value: name, maxlength: String(ITEM_MAX_CHARS), class: 'js-chip-input', 'data-key': `${list}-edit`, 'data-testid': `j-set-${list}-edit`, 'aria-label': `${name} 이름 바꾸기` });
        const ok = h('button', { type: 'button', class: 'js-mini primary', 'data-testid': `j-set-${list}-edit-ok` }, '확인');
        const cancel = h('button', { type: 'button', class: 'js-mini' }, '취소');
        const done = () => apply(renameItem(items, i, input.value), `${list}-edit`);
        ok.addEventListener('click', done);
        input.addEventListener('keydown', (e) => e.key === 'Enter' && done());
        cancel.addEventListener('click', () => {
          editing = null;
          listError = null;
          redraw(`${list}-${i}`);
        });
        return h('span', { class: 'js-chip editing' }, input, ok, cancel);
      }
      const nameBtn = h('button', { type: 'button', class: 'js-chip-name', 'data-key': `${list}-${i}`, title: '눌러서 이름 바꾸기' }, name);
      nameBtn.addEventListener('click', () => {
        editing = { list, index: i };
        listError = null;
        redraw(`${list}-edit`);
      });
      const x = h('button', { type: 'button', class: 'js-chip-x', 'aria-label': `${name} 지우기`, 'data-testid': `j-set-${list}-del-${i}` }, '✕');
      x.addEventListener('click', () => {
        const before = [...items];
        apply({ ok: true, list: removeItem(items, i) }, `${list}-add`, {
          text: `「${name}」 지웠어요`,
          undo: () => commit((s) => (s[list] = before), `${list}-add`),
        });
      });
      return h('span', { class: 'js-chip', 'data-testid': `j-set-${list}-chip` }, nameBtn, x);
    });
    const full = items.length >= max;
    const input = h('input', { type: 'text', maxlength: String(ITEM_MAX_CHARS), placeholder: full ? `최대 ${max}개예요` : placeholder, class: 'js-add-input', 'data-key': `${list}-add`, 'data-testid': `j-set-${list}-add`, 'aria-label': `${title} 추가`, disabled: full });
    const add = h('button', { type: 'button', class: 'js-mini primary', 'data-testid': `j-set-${list}-add-ok`, disabled: full }, '＋ 추가');
    const doAdd = () => apply(addItem(items, input.value, max), `${list}-add`);
    add.addEventListener('click', doAdd);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && doAdd());
    const err = listError && listError.list === list ? h('small', { class: 'js-err', role: 'alert', 'data-testid': `j-set-${list}-err` }, listError.text) : null;
    return card(
      'lists', title, desc, h('span', { class: 'js-count', 'data-testid': `j-set-${list}-count` }, `${items.length} / ${max}`),
      h('div', { class: 'js-chips' }, ...chips, items.length ? null : h('small', { class: 'muted' }, '아직 없어요. 아래에서 추가해 주세요.')),
      h('div', { class: 'js-add' }, input, add),
      err,
    );
  }

  function riskCard(s: JournalSettings): HTMLElement {
    const a = s.autoRisk;
    const sw = toggle('ar', a.enabled, '위험 자동 조절 켜기', (on) => commit((x) => (x.autoRisk.enabled = on), 'ar'));
    const ex = autoRiskExample(a, deps.capital ?? 10_000);
    const usd = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const example = `${deps.capital ? '내 총 자산' : '예: 총 자산'} ${usd(ex.capital)} USDT → 평소 한 번에 ${usd(ex.base)} USDT 위험 · 누적 +${usd(ex.threshold)} USDT를 넘으면 ${usd(ex.up)} USDT 위험`;
    return h(
      'div',
      { class: 'js-card js-wide', 'data-section': 'risk', 'data-on': String(a.enabled) },
      h('div', { class: 'js-card-head' }, h('h3', {}, '위험 자동 조절'), h('span', { class: 'js-state' }, a.enabled ? '켜짐' : '꺼짐'), sw),
      h('p', { class: 'js-desc' }, '수익이 쌓이면 한 번에 거는 위험을 키우고, 까먹으면 평소로 되돌려요. 계산기에 총 자산을 넣었을 때만 작동해요.'),
      h(
        'div',
        { class: 'js-sentence' },
        '평소에는 한 번에 ',
        stepper('ar-base', a.basePct, R_RISK, '%', (v) => commit((x) => (x.autoRisk.basePct = v), undefined), { label: '평소 위험' }),
        ' 를 걸고, 누적 수익이 총 자산의 ',
        stepper('ar-th', a.thresholdPct, R_THRESHOLD, '%', (v) => commit((x) => (x.autoRisk.thresholdPct = v), undefined), { label: '누적 수익률 기준' }),
        ' 를 넘으면 ',
        stepper('ar-up', a.upPct, R_RISK, '%', (v) => commit((x) => (x.autoRisk.upPct = v), undefined), { label: '수익이 쌓였을 때 위험' }),
        ' 로 올려요.',
      ),
      h('p', { class: 'js-example', 'data-testid': 'j-set-ar-example' }, example, deps.capital ? null : h('small', {}, ' (계산기에 총 자산을 넣으면 내 금액으로 보여요)')),
    );
  }

  function dataCard(): HTMLElement {
    const line = (title: string, sub: string, btn: HTMLElement) => h('div', { class: 'js-row' }, h('div', { class: 'js-row-text' }, h('b', {}, title), h('small', {}, sub)), h('div', { class: 'js-row-ctl' }, btn));
    return h(
      'div',
      { class: 'js-card js-wide', 'data-section': 'data' },
      h('div', { class: 'js-card-head' }, h('h3', {}, '백업·내보내기')),
      h('p', { class: 'js-desc' }, '기록은 이 브라우저에만 저장돼요. 브라우저 기록을 지우면 같이 사라지니 가끔 백업해 두세요.'),
      line('백업 저장', `거래와 설정을 파일 하나로 내려받아요 · ${deps.backupAge ?? '아직 백업 안 함'}`, deps.backup),
      line('백업 불러오기', '백업 파일을 지금 기록에 합쳐요. 지금 기록은 지워지지 않아요.', deps.restore),
      line('CSV 내보내기', '엑셀에서 보는 용도예요. 다시 불러올 수는 없어요.', deps.csv),
    );
  }

  function build(): HTMLElement {
    const s = ctx.journal.settings;
    const nav = h(
      'nav',
      { class: 'js-nav', 'aria-label': '설정 묶음' },
      ...SECTIONS.map(([k, label]) => {
        const b = h('button', { type: 'button', class: k === active ? 'on' : '', 'data-key': `nav-${k}`, 'data-testid': `j-set-nav-${k}` }, label);
        b.addEventListener('click', () => {
          active = k;
          pendingScroll = k;
          redraw(`nav-${k}`);
        });
        return b;
      }),
    );
    const undo = flash?.undo;
    const undoBtn = undo ? h('button', { type: 'button', class: 'js-undo', 'data-testid': 'j-set-undo' }, '되돌리기') : null;
    undoBtn?.addEventListener('click', undo!);
    const reset = h('button', { type: 'button', class: 'js-reset', 'data-testid': 'j-set-reset' }, '기본값으로');
    reset.addEventListener('click', () => {
      const before = JSON.parse(JSON.stringify(ctx.journal.settings)) as JournalSettings;
      const fresh = JSON.parse(JSON.stringify(DEFAULT_JOURNAL_SETTINGS)) as JournalSettings;
      commit((x) => Object.assign(x, fresh), undefined, { text: '기본값으로 되돌렸어요', undo: () => commit((x) => Object.assign(x, before)) });
    });
    const status = h(
      'div',
      { class: 'js-status', role: 'status', 'data-testid': 'j-set-status', 'data-saved': String(!!flash) },
      h('span', {}, flash ? flash.text : '바꾸면 바로 저장돼요'),
      undoBtn,
    );
    const el = h(
      'section',
      { class: 'j-section js-settings', 'data-testid': 'j-settings' },
      nav,
      h(
        'div',
        { class: 'js-body' },
        h('div', { class: 'js-top' }, h('h2', {}, '설정'), status, reset),
        h(
          'div',
          { class: 'js-grid' },
          dailyCard(s),
          limitsCard(s),
          listCard('setups', '셋업 목록', '거래를 기록할 때 고르는 이름표예요. 이름을 누르면 바꿀 수 있어요.', MAX_SETUPS, '새 셋업 이름'),
          listCard('rules', '나의 진입 규칙', '기록할 때 체크하는 목록이에요. 지킨 거래와 안 지킨 거래 성적을 비교해 줘요.', MAX_RULES, '새 규칙'),
          riskCard(s),
          dataCard(),
        ),
      ),
    );
    if (pendingScroll) {
      const key = pendingScroll;
      pendingScroll = null;
      window.requestAnimationFrame(() => el.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
    return el;
  }

  return current;
}
