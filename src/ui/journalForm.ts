import { JOURNAL_KEY, parseJournal, type Journal, type Trade } from '../core/journal';
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
 * 차트 박스 옆 「진입」 버튼 (2026-11-11, 예전 「📒 저널에 기록」 폼을 대신한다).
 * 한 번 누르면 계산기 값 그대로 가상 거래가 저널 「진행 중」에 올라간다 — 진입 때는 아무것도 묻지 않는다
 * (셋업·근거·칩은 나중에 저널에서). 같은 계산(시나리오 id)은 한 번만. 직후 5초 되돌리기.
 * 그 뒤 손절·목표에 닿았는지는 data/virtualTracker.ts가 따라간다.
 */
export class EntryButton {
  readonly root: HTMLDivElement;
  private readonly enter: HTMLButtonElement;
  private readonly open: HTMLAnchorElement;

  constructor(
    private readonly storage: StorageLike,
    private readonly context: () => RecordContext | null,
    private readonly onChanged: (j: Journal) => void,
    private readonly toast: (msg: string) => void,
    private readonly offerUndo: (message: string, run: () => void) => void,
  ) {
    this.enter = h('button', { type: 'button', class: 'entry-btn', 'data-testid': 'vt-enter' }, '진입');
    this.enter.addEventListener('click', () => this.doEnter());
    this.open = h('a', { class: 'entry-open', href: '/journal', 'data-testid': 'vt-open', title: '가상 거래 진행 중 — 손절·목표에 닿으면 자동 청산돼요. 누르면 저널로', hidden: true }, '✓ 진행 중');
    this.root = h('div', { class: 'entry-action', 'data-testid': 'vt-action', hidden: true }, this.enter, this.open);
    // 차트 위에 떠 있다: 누름이 차트(진입가 찍기·박스 끌기)로 새지 않게
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'contextmenu'] as const) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  /** 계산이 바뀔 때마다: 계산이 없으면 숨김, 이미 진입한 계산이면 「✓ 진행 중」 */
  render(scenario: Scenario | null): void {
    show(this.root, !!scenario);
    if (!scenario) return;
    const mine = loadJournal(this.storage).trades.find((t) => t.id === scenario.id);
    show(this.enter, !mine);
    show(this.open, !!mine);
    if (mine) setText(this.open, mine.exit === null ? '✓ 진행 중' : '✓ 청산됨');
    const noSl = scenario.applied.sl === null;
    this.enter.disabled = noSl;
    this.enter.title = noSl ? '손절가가 있어야 진입할 수 있어요 (R을 계산하려고)' : '가상 진입 — 저널에 올리고 손절·목표에 닿으면 자동 청산';
  }

  private doEnter(): void {
    const ctx = this.context();
    if (!ctx) return;
    const s = ctx.scenario;
    if (s.applied.sl === null) return;
    const j = loadJournal(this.storage);
    if (j.trades.some((t) => t.id === s.id)) {
      this.render(s);
      return;
    }
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
      setup: '',
      quality: 'rule',
      reason: '',
      rules: [],
      feeRate: ctx.feeRate,
    };
    j.trades.push(trade);
    if (!saveJournal(this.storage, j)) {
      this.toast('저장하지 못했어요 (브라우저 저장소가 막혀 있어요).');
      return;
    }
    this.onChanged(j);
    this.render(s);
    this.offerUndo(`가상 진입했어요 · ${s.symbol.replace(/USDT$/, '')} ${s.side === 'LONG' ? '롱' : '숏'}`, () => {
      // 그 사이 다른 탭에서 바뀐 것을 잃지 않게 다시 읽고, 아직 열려 있을 때만 뺀다
      const cur = loadJournal(this.storage);
      const before = cur.trades.length;
      cur.trades = cur.trades.filter((t) => !(t.id === trade.id && t.exit === null));
      if (cur.trades.length !== before && saveJournal(this.storage, cur)) this.onChanged(cur);
      const now = this.context();
      this.render(now ? now.scenario : null);
    });
  }
}
