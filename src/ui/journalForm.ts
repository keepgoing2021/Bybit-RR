import { JOURNAL_KEY, parseJournal, QUALITY_LABEL, type Journal, type Quality, type Trade } from '../core/journal';
import type { StorageLike } from '../core/persistence';
import type { Scenario } from '../core/scenario';
import { h, setText, show } from './dom';

export interface RecordContext {
  scenario: Scenario;
  qty: number | null;
  riskUsdt: number | null;
  riskPct: number | null;
  feeRate: number;
}

export function loadJournal(storage: StorageLike): Journal {
  try {
    return parseJournal(storage.getItem(JOURNAL_KEY));
  } catch {
    return parseJournal(null);
  }
}

export function saveJournal(storage: StorageLike, j: Journal): boolean {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify(j));
    return true;
  } catch {
    return false;
  }
}

/**
 * 계산기 패널의 「📒 저널에 기록」 (2026-11-06). 종목·방향·진입·손절·수량·리스크는 계산기 값 그대로,
 * 사용자는 셋업·품질·근거 한 줄·지킨 규칙만 고른다. 같은 계산(시나리오 id)은 한 번만 기록된다.
 */
export class JournalForm {
  readonly root: HTMLDivElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly form: HTMLDivElement;
  private readonly done: HTMLParagraphElement;
  private readonly setup: HTMLSelectElement;
  private readonly newSetup: HTMLInputElement;
  private readonly reason: HTMLInputElement;
  private readonly rulesBox: HTMLDivElement;
  private readonly qualityBtns = new Map<Quality, HTMLButtonElement>();
  private quality: Quality = 'rule';
  private scenarioId: string | null = null;

  constructor(
    private readonly storage: StorageLike,
    private readonly context: () => RecordContext | null,
    private readonly onSaved: (j: Journal) => void,
    private readonly toast: (msg: string) => void,
  ) {
    this.openBtn = h('button', { type: 'button', class: 'journal-open', 'data-testid': 'journal-open' }, '📒 저널에 기록');
    this.openBtn.addEventListener('click', () => this.setOpen(true));
    this.setup = h('select', { class: 'journal-setup', 'data-testid': 'journal-setup', 'aria-label': '셋업' });
    this.newSetup = h('input', { class: 'journal-new-setup', placeholder: '+ 새 셋업 이름', maxlength: '40', 'aria-label': '새 셋업 추가' });
    this.newSetup.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addSetup();
    });
    this.newSetup.addEventListener('change', () => this.addSetup());
    const quality = h('div', { class: 'journal-quality', role: 'group', 'aria-label': '진입 품질' });
    for (const q of ['rule', 'high', 'break'] as Quality[]) {
      const b = h('button', { type: 'button', 'data-q': q, 'data-testid': `journal-q-${q}` }, QUALITY_LABEL[q]);
      b.addEventListener('click', () => {
        this.quality = q;
        this.paintQuality();
      });
      this.qualityBtns.set(q, b);
      quality.append(b);
    }
    this.reason = h('input', { class: 'journal-reason', 'data-testid': 'journal-reason', maxlength: '200', placeholder: '근거 한 줄 (예: 4시간 추세전환 + 15분 눌림)' });
    this.rulesBox = h('div', { class: 'journal-rules', 'data-testid': 'journal-rules' });
    const save = h('button', { type: 'button', class: 'journal-save', 'data-testid': 'journal-save' }, '기록');
    save.addEventListener('click', () => this.save());
    const cancel = h('button', { type: 'button', class: 'link' }, '닫기');
    cancel.addEventListener('click', () => this.setOpen(false));
    this.form = h(
      'div',
      { class: 'journal-form', hidden: true },
      h('label', { class: 'journal-field' }, h('span', {}, '셋업'), h('div', { class: 'journal-setup-row' }, this.setup, this.newSetup)),
      h('div', { class: 'journal-field' }, h('span', {}, '품질'), quality),
      h('label', { class: 'journal-field' }, h('span', {}, '근거'), this.reason),
      h('div', { class: 'journal-field' }, h('span', {}, '지킨 규칙'), this.rulesBox),
      h('div', { class: 'journal-actions' }, cancel, save),
    );
    this.done = h('p', { class: 'journal-done', 'data-testid': 'journal-done', hidden: true });
    this.root = h('div', { class: 'panel-card journal-card', 'data-testid': 'journal-card' }, this.openBtn, this.form, this.done);
    this.paintQuality();
  }

  /** 계산이 바뀔 때: 이미 기록한 계산이면 「기록됨」 */
  render(scenario: Scenario | null): void {
    if (!scenario) return;
    if (scenario.id !== this.scenarioId) {
      this.scenarioId = scenario.id;
      this.setOpen(false);
    }
    const j = loadJournal(this.storage);
    const recorded = j.trades.find((t) => t.id === scenario.id);
    show(this.openBtn, recorded === undefined && this.form.hidden === true);
    show(this.done, !!recorded);
    if (recorded) {
      this.done.replaceChildren(
        `✓ 저널에 기록됨 (${recorded.setup || '셋업 없음'} · ${QUALITY_LABEL[recorded.quality]}) · 청산하면 `,
        h('a', { href: '/journal', 'data-testid': 'journal-link-done' }, '저널에서 청산가 입력'),
      );
    }
  }

  private setOpen(open: boolean): void {
    if (open) this.fill();
    show(this.form, open);
    show(this.openBtn, !open);
  }

  /** 셋업 목록·내 규칙은 저널 설정에서 */
  private fill(): void {
    const j = loadJournal(this.storage);
    const cur = this.setup.value;
    this.setup.replaceChildren(h('option', { value: '' }, '고르기'), ...j.settings.setups.map((s) => h('option', { value: s }, s)));
    if (cur && j.settings.setups.includes(cur)) this.setup.value = cur;
    this.rulesBox.replaceChildren(
      ...j.settings.rules.map((r) => h('label', { class: 'journal-rule' }, h('input', { type: 'checkbox', value: r }), r)),
    );
    if (!j.settings.rules.length) this.rulesBox.append(h('span', { class: 'muted small' }, '저널 설정에서 내 규칙을 넣을 수 있어요'));
  }

  private addSetup(): void {
    const name = this.newSetup.value.trim().slice(0, 40);
    if (!name) return;
    const j = loadJournal(this.storage);
    if (!j.settings.setups.includes(name)) j.settings.setups.push(name);
    saveJournal(this.storage, j);
    this.newSetup.value = '';
    this.fill();
    this.setup.value = name;
  }

  private paintQuality(): void {
    for (const [q, b] of this.qualityBtns) {
      b.classList.toggle('on', q === this.quality);
      b.setAttribute('aria-pressed', String(q === this.quality));
    }
  }

  private save(): void {
    const ctx = this.context();
    if (!ctx) return;
    const s = ctx.scenario;
    if (s.applied.sl === null) {
      this.toast('손절가가 있어야 기록할 수 있어요 (R을 계산하려고).');
      return;
    }
    const j = loadJournal(this.storage);
    if (j.trades.some((t) => t.id === s.id)) return;
    const rules = [...this.rulesBox.querySelectorAll<HTMLInputElement>('input:checked')].map((x) => x.value);
    const trade: Trade = {
      id: s.id,
      symbol: s.symbol,
      side: s.side,
      entry: s.entry,
      sl: s.applied.sl,
      tp: s.applied.tp,
      qty: ctx.qty,
      riskUsdt: ctx.riskUsdt,
      riskPct: ctx.riskPct,
      openedAt: Date.now(),
      closedAt: null,
      exit: null,
      setup: this.setup.value,
      quality: this.quality,
      reason: this.reason.value.trim().slice(0, 200),
      rules,
      feeRate: ctx.feeRate,
    };
    j.trades.push(trade);
    if (!saveJournal(this.storage, j)) {
      this.toast('저장하지 못했어요 (브라우저 저장소가 막혀 있어요).');
      return;
    }
    this.reason.value = '';
    this.setOpen(false);
    setText(this.done, '');
    this.onSaved(j);
    this.render(s);
    this.toast('저널에 기록했어요. 청산하면 저널에서 청산가만 넣으면 돼요.');
  }
}
