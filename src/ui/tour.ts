import { h, setText, show } from './dom';

export interface TourStep {
  /** 비출 곳. 지금 안 보이면(폰에서 접힌 칸 등) null → 그 단계는 건너뛴다 */
  target(): HTMLElement | null;
  title: string;
  body: string;
}

/** 비춘 곳 둘레 여백, 화면 가장자리 여백, 말풍선과의 간격 (px) */
const PAD = 6;
const EDGE = 12;
const GAP = 10;
const TIP_MAX_W = 300;

/**
 * 첫 사용 안내: 화면을 어둡게 하고 한 곳씩 비추며 말풍선으로 설명한다.
 * 건너뛰기·이전·다음(마지막은 시작하기), Esc = 건너뛰기, →·Enter = 다음, ← = 이전.
 * 끝내거나 건너뛰면 onDone (앱이 '봤음'을 저장해 다시 들어와도 자동으로 뜨지 않게).
 */
export class Tour {
  readonly root: HTMLDivElement;
  private readonly spot: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLParagraphElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private steps: TourStep[] = [];
  private i = 0;
  private frame = 0;
  private readonly reflow = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.place(false));
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.isOpen()) return;
    // 안내가 떠 있는 동안 키는 뒤의 화면(Delete로 지우기, Ctrl+Z 등)에 넘기지 않는다
    e.stopPropagation();
    if (e.key === 'Escape') this.finish();
    else if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
    // 버튼에 포커스가 있으면 Enter는 그 버튼이 처리한다 (두 번 넘어가지 않게)
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement && this.tip.contains(e.target))) this.next();
    else if (e.key === 'Tab') this.trapFocus(e.shiftKey);
    else return;
    e.preventDefault();
  };

  /** Tab은 말풍선 버튼 안에서만 돈다 */
  private trapFocus(back: boolean): void {
    const btns = [...this.tip.querySelectorAll('button')].filter((b) => !b.hidden);
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    const j = at < 0 ? 0 : (at + (back ? -1 : 1) + btns.length) % btns.length;
    btns[j]?.focus();
  }

  constructor(private readonly onDone: () => void) {
    this.spot = h('div', { class: 'tour-spot', 'data-testid': 'tour-spot' });
    this.count = h('span', { class: 'tour-count', 'data-testid': 'tour-count' });
    this.title = h('b', { class: 'tour-title', 'data-testid': 'tour-title' });
    this.body = h('p', { class: 'tour-body' });
    const skip = h('button', { type: 'button', class: 'tour-skip', 'data-testid': 'tour-skip' }, '건너뛰기');
    this.prevBtn = h('button', { type: 'button', class: 'tour-prev', 'data-testid': 'tour-prev' }, '이전');
    this.nextBtn = h('button', { type: 'button', class: 'tour-next', 'data-testid': 'tour-next' }, '다음');
    this.tip = h(
      'div',
      { class: 'tour-tip', 'data-testid': 'tour-tip', role: 'dialog', 'aria-modal': 'true', 'aria-label': '사용 안내' },
      this.count,
      this.title,
      this.body,
      h('div', { class: 'tour-actions' }, skip, this.prevBtn, this.nextBtn),
    );
    this.root = h('div', { class: 'tour', 'data-testid': 'tour', hidden: true }, this.spot, this.tip);
    skip.addEventListener('click', () => this.finish());
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  open(steps: TourStep[]): void {
    this.steps = steps;
    this.i = this.seek(0, 1);
    if (this.i < 0) return;
    show(this.root, true);
    this.root.classList.add('instant'); // 처음에는 미끄러지지 않고 제자리에
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.reflow);
    window.addEventListener('scroll', this.reflow, true);
    this.render();
  }

  private close(): void {
    show(this.root, false);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.reflow);
    window.removeEventListener('scroll', this.reflow, true);
    cancelAnimationFrame(this.frame);
  }

  private finish(): void {
    this.close();
    this.onDone();
  }

  private next(): void {
    const j = this.seek(this.i + 1, 1);
    if (j < 0) this.finish();
    else this.go(j);
  }

  private prev(): void {
    const j = this.seek(this.i - 1, -1);
    if (j >= 0) this.go(j);
  }

  private go(j: number): void {
    this.i = j;
    this.root.classList.remove('instant');
    this.render();
  }

  /** from부터 dir 방향으로 지금 보이는 대상이 있는 단계 */
  private seek(from: number, dir: 1 | -1): number {
    for (let j = from; j >= 0 && j < this.steps.length; j += dir) {
      const t = this.steps[j].target();
      if (t && t.getClientRects().length) return j;
    }
    return -1;
  }

  private visible(): number[] {
    return this.steps.map((_, j) => j).filter((j) => {
      const t = this.steps[j].target();
      return !!t && t.getClientRects().length > 0;
    });
  }

  private render(): void {
    const s = this.steps[this.i];
    const shown = this.visible();
    const k = shown.indexOf(this.i);
    setText(this.count, `${k + 1} / ${shown.length}`);
    setText(this.title, s.title);
    setText(this.body, s.body);
    show(this.prevBtn, k > 0);
    setText(this.nextBtn, k === shown.length - 1 ? '시작하기' : '다음');
    s.target()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.place(true);
    // 키보드로 바로 넘길 수 있게 '다음'에 포커스 (마우스·터치로 왔으면 포커스 테두리는 그리지 않는다)
    this.nextBtn.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }

  /** 대상 둘레를 비추고, 말풍선은 아래 → 위 → 화면 아래쪽 순으로 들어가는 곳에 */
  private place(stepChange: boolean): void {
    if (!this.isOpen()) return;
    const t = this.steps[this.i]?.target();
    if (!t) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const r = t.getBoundingClientRect();
    // 여백을 둘러 비추되 화면 밖으로는 넘기지 않는다
    const x1 = Math.max(0, r.left - PAD);
    const y1 = Math.max(0, r.top - PAD);
    const x2 = Math.min(vw, r.right + PAD);
    const y2 = Math.min(vh, r.bottom + PAD);
    Object.assign(this.spot.style, { left: `${x1}px`, top: `${y1}px`, width: `${Math.max(0, x2 - x1)}px`, height: `${Math.max(0, y2 - y1)}px` });

    const w = Math.min(TIP_MAX_W, vw - EDGE * 2);
    this.tip.style.width = `${w}px`;
    const th = this.tip.offsetHeight;
    let top: number;
    if (y2 + GAP + th <= vh - EDGE) top = y2 + GAP;
    else if (y1 - GAP - th >= EDGE) top = y1 - GAP - th;
    else top = vh - EDGE - th; // 비춘 곳이 화면을 거의 다 차지하면 그 안쪽 아래에 겹쳐 둔다
    const left = Math.min(Math.max(EDGE, x1), vw - EDGE - w);
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${Math.max(EDGE, top)}px`;
    this.root.dataset.step = String(this.i + 1);
    if (!stepChange) this.root.classList.add('instant');
  }
}
