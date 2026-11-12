import '../styles.css';
import './journal.css';
import {
  AUTO_LABEL, backupAgeText, BACKUP_MAX_CHARS, CLOSE_RULE_LABEL, computeStats, groupStats, JOURNAL_KEY, limitStatus, mergeJournal, MIN_GROUP_TRADES, MOOD_LABEL, parseBackup, QUALITY_LABEL, sessionOf,
  toBackup, toCsv, tradeResult,
  type Journal, type Stats, type Trade,
} from '../core/journal';
import { avgHoldMs, dayKey, maxDrawdownR, maxStreaks, monthlyRows } from '../core/journalInsights';
import { CONFIG } from '../config';
import { loadSizing, safeStorage } from '../core/persistence';
import { fetchLastPrice } from '../data/bybit/klineRange';
import { trackOpenTrades } from '../data/virtualTracker';
import { h, setText } from '../ui/dom';
import { siteNav } from '../ui/siteNav';
import { loadJournal, saveJournal } from '../ui/journalForm';
import { renderCalendar, type CalView } from './calendar';
import { chipRow, noteEditor, renderOpen } from './closeCard';
import type { Ctx } from './ctx';
import { renderCurve } from './curve';
import { fmtDay, fmtElapsed, fmtHold, fmtPct, fmtR, fmtTime, fmtUsd, sign } from './format';
import { renderNumbers } from './home';
import { renderReview } from './review';
import { openSettingsSection, renderSettings } from './settings';

/**
 * 1rc.app/journal — 거래 저널 (2026-11-06). 계산기와 같은 브라우저 저장소(rrtool.v1.journal)를 쓴다.
 * 2026-11-11 개편: 첫 화면 = (주간 리뷰) → 진행 중(청산 카드) → 숫자 3개 → 달력 → 누적 R → 탭(거래 목록 / 통계 / 설정)
 */
const storage = safeStorage(() => window.localStorage);
const root = document.getElementById('app')!;
const nav = siteNav('journal');
let journal: Journal = loadJournal(storage);
type GroupKey = 'setup' | 'quality' | 'session' | 'side' | 'symbol';
let groupBy: GroupKey = 'setup';
let showAll = false;

const GROUPS: [GroupKey, string, (t: Trade) => string][] = [
  ['setup', '셋업', (t) => t.setup || '셋업 없음'],
  ['quality', '품질', (t) => QUALITY_LABEL[t.quality]],
  ['session', '세션', (t) => sessionOf(t.openedAt)],
  ['side', '방향', (t) => (t.side === 'LONG' ? '롱' : '숏')],
  ['symbol', '종목', (t) => t.symbol.replace(/USDT$/, '')],
];

type Tab = 'list' | 'stats' | 'settings';
const TABS: [Tab, string][] = [['list', '거래 목록'], ['stats', '통계'], ['settings', '설정']];
const TAB_KEY = 'rrtool.v1.journalTab';
const CAL_KEY = 'rrtool.v1.journalCalView';
/** 화면 형태 기억 (이 브라우저). 못 읽거나 모르는 값이면 기본값 */
function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = storage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // 기억만 못 한다
  }
}
let tab: Tab = remembered(TAB_KEY, ['list', 'stats', 'settings'] as const, 'list');
let calView: CalView = remembered(CAL_KEY, ['strip', 'month'] as const, 'strip');
const kstNow = new Date(Date.now() + 9 * 3600_000);
let calMonth = { y: kstNow.getUTCFullYear(), m0: kstNow.getUTCMonth() };
/** 달력에서 고른 날 (그날 끝난 거래만 보기) */
let dayFilter: string | null = null;
/** 거래 목록에서 칩을 채우는 중인 거래 */
let fillId: string | null = null;

const netFetch = (url: string) => fetch(url);

const ctx: Ctx = {
  get journal() {
    return journal;
  },
  persist,
  save: () => {
    const ok = saveJournal(storage, journal);
    if (!ok) alertBox('저장하지 못했어요 (브라우저 저장소가 막혀 있어요).');
    return ok;
  },
  rerender: () => render(),
  toast: alertBox,
  now: () => Date.now(),
  lastPrice: (symbol) => fetchLastPrice(netFetch, CONFIG.bybit.restBases, symbol),
};

/** 마지막으로 백업 파일을 내려받은 시각 (이 브라우저) */
const BACKUP_AT_KEY = 'rrtool.v1.journalBackupAt';
function lastBackupAt(): number | null {
  try {
    const v = Number(storage.getItem(BACKUP_AT_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function download(name: string, text: string, type: string): void {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function saveBackup(): void {
  download(`1rc-journal-backup-${new Date().toISOString().slice(0, 10)}.json`, toBackup(journal, Date.now()), 'application/json');
  try {
    storage.setItem(BACKUP_AT_KEY, String(Date.now()));
  } catch {
    // 날짜만 못 적는다 — 파일은 내려받아졌다
  }
  render();
  alertBox(`거래 ${journal.trades.length}건과 설정을 파일로 저장했어요.`);
}

/** 백업 파일 불러오기 — 지금 기록은 지우지 않고 합친다 */
async function restoreBackup(file: File): Promise<void> {
  if (file.size > BACKUP_MAX_CHARS * 4) {
    alertBox('파일이 너무 커요.');
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    alertBox('파일을 읽지 못했어요.');
    return;
  }
  const read = parseBackup(text);
  if (!read.ok) {
    alertBox(read.reason);
    return;
  }
  // 다른 탭(계산기)에서 방금 기록한 것도 잃지 않게 저장소에서 다시 읽고 합친다
  const merged = mergeJournal(loadJournal(storage), read.journal);
  journal = merged.journal;
  if (!saveJournal(storage, journal)) {
    alertBox('저장하지 못했어요 (브라우저 저장소가 막혀 있거나 가득 찼어요).');
    render();
    return;
  }
  render();
  const parts = [`${merged.added}건 불러왔어요`];
  if (merged.updated) parts.push(`청산 반영 ${merged.updated}건`);
  if (merged.kept) parts.push(`이미 있던 ${merged.kept}건은 그대로`);
  if (read.skipped) parts.push(`읽지 못한 줄 ${read.skipped}개`);
  alertBox(`${parts.join(' · ')}.`);
}

function persist(): void {
  if (!saveJournal(storage, journal)) alertBox('저장하지 못했어요 (브라우저 저장소가 막혀 있어요).');
  render();
}

function alertBox(msg: string): void {
  const n = h('div', { class: 'j-toast', role: 'status' }, msg);
  document.body.append(n);
  window.setTimeout(() => n.remove(), 3500);
}

function statCard(label: string, value: string, sub: string, tone = ''): HTMLElement {
  return h('div', { class: 'j-stat', 'data-tone': tone }, h('span', { class: 'j-stat-label' }, label), h('b', { class: 'j-stat-value num' }, value), h('span', { class: 'j-stat-sub' }, sub));
}

function renderSummary(s: Stats): HTMLElement {
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-summary' },
    h('h2', {}, '요약'),
    h(
      'div',
      { class: 'j-stats' },
      statCard('기대값 (거래당)', fmtR(s.expectancyR), '승률보다 이게 핵심 · 수수료 뺌', sign(s.expectancyR)),
      statCard('승률', fmtPct(s.winRate), `${s.wins}승 ${s.losses}패 ${s.breakeven}본전`),
      statCard('평균 손익비', s.avgRR === null ? '—' : `1 : ${s.avgRR.toFixed(2)}`, '평균 이익 ÷ 평균 손실'),
      statCard('순손익', `${fmtUsd(s.netPnl)} USDT`, `합계 ${fmtR(s.totalR)} · ${s.trades}건`, sign(s.netPnl)),
      statCard('규칙 지킨 비율', fmtPct(s.rcr), `위반 ${s.ruleBreaks}건 · ${fmtUsd(s.ruleBreakPnl)} USDT`, s.rcr !== null && s.rcr < 0.8 ? 'down' : ''),
      statCard('최대 낙폭', s.trades ? fmtR(-maxDrawdownR(journal.trades)) : '—', '고점에서 가장 많이 내려온 폭', maxDrawdownR(journal.trades) > 0 ? 'down' : ''),
      statCard('최대 연속', `${maxStreaks(journal.trades).win}승 / ${maxStreaks(journal.trades).loss}패`, '본전은 연속을 끊어요'),
      statCard('평균 보유 시간', fmtHold(avgHoldMs(journal.trades)), '진입 → 청산'),
    ),
  );
}

function renderLimits(): HTMLElement {
  const names = { day: '오늘', week: '이번 주', month: '이번 달' } as const;
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-limits' },
    h('h2', {}, '손실 한도'),
    h(
      'div',
      { class: 'j-limits' },
      ...limitStatus(journal.trades, journal.settings.limits, Date.now()).map((l) =>
        h(
          'div',
          { class: 'j-limit', 'data-state': l.limit <= 0 ? 'off' : l.exceeded ? 'over' : 'ok' },
          h('span', {}, names[l.period]),
          h('b', { class: 'num' }, fmtR(l.r)),
          h('span', { class: 'j-limit-badge' }, l.limit <= 0 ? '한도 없음' : l.exceeded ? `초과 (한도 −${l.limit}R) · 멈추기` : `통과 (한도 −${l.limit}R)`),
        ),
      ),
    ),
  );
}

function deleteBtn(t: Trade): HTMLButtonElement {
  // 확인 창 대신 두 번 누르기 (한 번 = 「정말?」)
  const b = h('button', { type: 'button', class: 'j-del', title: '이 기록 지우기' }, '지우기');
  let armed = false;
  b.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      setText(b, '정말?');
      b.classList.add('armed');
      window.setTimeout(() => {
        armed = false;
        setText(b, '지우기');
        b.classList.remove('armed');
      }, 3000);
      return;
    }
    journal.trades = journal.trades.filter((x) => x.id !== t.id);
    persist();
  });
  return b;
}

function renderClosed(): HTMLElement {
  const all = journal.trades.filter((t) => t.exit !== null).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const closed = dayFilter === null ? all : all.filter((t) => t.closedAt !== null && dayKey(t.closedAt) === dayFilter);
  const list = showAll ? closed : closed.slice(0, 30);
  const cols = ['청산', '종목', '셋업', '품질', '세션', '보유', 'R', '순손익', '규칙 · 상태', '근거', ''];
  const head = h('tr', {}, ...cols.map((x) => h('th', {}, x)));
  const rows = list.flatMap((t) => {
    const res = tradeResult(t);
    const chips = [t.closeRule ? CLOSE_RULE_LABEL[t.closeRule] : null, t.mood ? MOOD_LABEL[t.mood] : null].filter(Boolean).join(' · ');
    const auto = t.auto ? h('span', { class: 'j-auto', 'data-testid': `j-auto-${t.id}` }, AUTO_LABEL[t.auto]) : null;
    const fill = h('button', { type: 'button', class: 'link', 'data-testid': `j-fill-${t.id}`, 'aria-expanded': String(fillId === t.id) }, chips || '채우기');
    const toggleFill = () => {
      fillId = fillId === t.id ? null : t.id;
      render();
    };
    fill.addEventListener('click', toggleFill);
    // 근거 칸 = 펼치는 버튼 (비어 있으면 「＋ 근거 쓰기」). 2026-11-12: 근거를 적을 곳이 없었다
    const note = h('button', { type: 'button', class: 'link j-note-btn', 'data-testid': `j-note-${t.id}`, 'aria-expanded': String(fillId === t.id), 'data-empty': String(!t.reason), title: t.reason || '셋업 · 진입 규칙 · 근거 쓰기' }, t.reason || '＋ 근거 쓰기');
    note.addEventListener('click', toggleFill);
    const setupCell = h('td', { 'data-testid': `j-setupcell-${t.id}` }, t.setup || '—');
    const qualityCell = h('td', { 'data-q': t.quality, 'data-testid': `j-qualitycell-${t.id}` }, QUALITY_LABEL[t.quality]);
    const row = h(
      'tr',
      { 'data-outcome': res?.outcome ?? '' },
      h('td', { class: 'num' }, t.closedAt ? fmtTime(t.closedAt) : ''),
      h('td', {}, h('b', { 'data-side': t.side }, `${t.symbol.replace(/USDT$/, '')} ${t.side === 'LONG' ? '롱' : '숏'}`)),
      setupCell,
      qualityCell,
      h('td', {}, sessionOf(t.openedAt)),
      h('td', { class: 'num', 'data-testid': `j-hold-${t.id}` }, fmtHold(t.closedAt !== null ? Math.max(0, t.closedAt - t.openedAt) : null)),
      h('td', { class: 'num', 'data-sign': sign(res?.r ?? null) }, fmtR(res?.r ?? null)),
      h('td', { class: 'num', 'data-sign': sign(res?.pnl ?? null) }, res?.pnl != null ? fmtUsd(res.pnl) : '—'),
      h('td', {}, auto, fill),
      h('td', { class: 'j-reason-cell' }, note),
      h('td', {}, deleteBtn(t)),
    );
    if (fillId !== t.id) return [row];
    // 누르면 바로 저장 (다시 그리지 않아 두 줄을 이어서 고를 수 있다)
    const store = () => void ctx.save();
    const showNote = () => {
      setText(setupCell, t.setup || '—');
      setText(qualityCell, QUALITY_LABEL[t.quality]);
      qualityCell.dataset.q = t.quality;
      setText(note, t.reason || '＋ 근거 쓰기');
      note.title = t.reason || '셋업 · 진입 규칙 · 근거 쓰기';
      note.dataset.empty = String(!t.reason);
    };
    const editor = h(
      'td',
      { colspan: String(cols.length), class: 'j-fill' },
      chipRow('규칙 지켰나', CLOSE_RULE_LABEL, t.closeRule, (v) => {
        if (v) t.closeRule = v;
        else delete t.closeRule;
        store();
      }, `j-rule-${t.id}`),
      chipRow('그때 상태', MOOD_LABEL, t.mood, (v) => {
        if (v) t.mood = v;
        else delete t.mood;
        store();
      }, `j-mood-${t.id}`),
      noteEditor(ctx, t, showNote),
    );
    return [row, h('tr', {}, editor)];
  });
  const more = closed.length > 30 ? h('button', { type: 'button', class: 'link' }, showAll ? '최근 30건만' : `전부 보기 (${closed.length}건)`) : null;
  more?.addEventListener('click', () => {
    showAll = !showAll;
    render();
  });
  const clear = dayFilter === null ? null : h('button', { type: 'button', class: 'link', 'data-testid': 'j-day-clear' }, `${fmtDay(dayFilter)}만 보는 중 · 전체 보기`);
  clear?.addEventListener('click', () => {
    dayFilter = null;
    render();
  });
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-closed' },
    h('div', { class: 'j-cal-head' }, h('h2', {}, `끝난 거래 ${closed.length}`), clear),
    closed.length ? h('div', { class: 'j-table-wrap' }, h('table', { class: 'j-table' }, h('thead', {}, head), h('tbody', {}, ...rows))) : h('p', { class: 'muted' }, '청산가를 넣으면 R·순손익(수수료 뺌)이 자동으로 계산돼요.'),
    more,
  );
}

function renderMonthly(): HTMLElement | null {
  const rows = monthlyRows(journal.trades);
  if (!rows.length) return null;
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-monthly' },
    h('h2', {}, '월별'),
    h(
      'div',
      { class: 'j-table-wrap' },
      h(
        'table',
        { class: 'j-table' },
        h('thead', {}, h('tr', {}, ...['달', '거래', '승률', '합계 R'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...rows.map((m) => h('tr', {}, h('td', { class: 'num' }, m.key), h('td', { class: 'num' }, String(m.trades)), h('td', { class: 'num' }, fmtPct(m.winRate)), h('td', { class: 'num', 'data-sign': sign(m.totalR) }, fmtR(m.totalR))))),
      ),
    ),
  );
}

function renderTabs(): HTMLElement {
  return h(
    'div',
    { class: 'j-tabs j-main-tabs', role: 'group', 'aria-label': '매매일지 메뉴' },
    ...TABS.map(([k, label]) => {
      const b = h('button', { type: 'button', class: k === tab ? 'on' : '', 'aria-pressed': String(k === tab), 'data-testid': `j-tab-${k}` }, label);
      b.addEventListener('click', () => {
        tab = k;
        remember(TAB_KEY, k);
        render();
      });
      return b;
    }),
  );
}

function renderGroups(): HTMLElement {
  const def = GROUPS.find((g) => g[0] === groupBy)!;
  const tabs = h(
    'div',
    { class: 'j-tabs', role: 'group' },
    ...GROUPS.map(([k, label]) => {
      const b = h('button', { type: 'button', class: k === groupBy ? 'on' : '', 'aria-pressed': String(k === groupBy) }, label);
      b.addEventListener('click', () => {
        groupBy = k;
        render();
      });
      return b;
    }),
  );
  const rows = groupStats(journal.trades, def[2]);
  const closedN = journal.trades.filter((t) => t.exit !== null).length;
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-groups' },
    h('h2', {}, '잘 되는 곳 / 안 되는 곳'),
    tabs,
    rows.length
      ? h(
          'div',
          { class: 'j-table-wrap' },
          h(
            'table',
            { class: 'j-table' },
            h('thead', {}, h('tr', {}, ...[def[1], '거래', '승률', '기대값', '합계 R', '순손익'].map((x) => h('th', {}, x)))),
            h(
              'tbody',
              {},
              ...rows.map((g) =>
                h(
                  'tr',
                  {},
                  h('td', {}, h('b', {}, g.key)),
                  h('td', { class: 'num' }, String(g.stats.trades)),
                  h('td', { class: 'num' }, fmtPct(g.stats.winRate)),
                  h('td', { class: 'num', 'data-sign': sign(g.stats.expectancyR) }, fmtR(g.stats.expectancyR)),
                  h('td', { class: 'num', 'data-sign': sign(g.stats.totalR) }, fmtR(g.stats.totalR)),
                  h('td', { class: 'num', 'data-sign': sign(g.stats.netPnl) }, fmtUsd(g.stats.netPnl)),
                ),
              ),
            ),
          ),
        )
      : null,
    h('p', { class: 'muted small' }, `${MIN_GROUP_TRADES}건 이상 쌓인 묶음만 보여요 (적은 건수는 우연일 수 있어서). 지금 끝난 거래 ${closedN}건.`),
  );
}

function render(): void {
  journal = loadJournal(storage);
  const stats = computeStats(journal.trades);
  const csv = h('button', { type: 'button', class: 'j-csv', 'data-testid': 'j-csv', title: '엑셀에서 보기용 (다시 불러올 수는 없어요)' }, 'CSV 받기');
  // 엑셀에서 한글이 깨지지 않게 BOM
  csv.addEventListener('click', () => download(`1rc-journal-${new Date().toISOString().slice(0, 10)}.csv`, '\uFEFF' + toCsv(journal.trades), 'text/csv;charset=utf-8'));
  const backup = h('button', { type: 'button', class: 'j-csv', 'data-testid': 'j-backup', title: '거래와 설정을 파일로 저장 (기기를 바꾸거나 브라우저 기록을 지워도 되살릴 수 있어요)' }, '파일로 저장');
  backup.addEventListener('click', saveBackup);
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: '', 'data-testid': 'j-restore-file', 'aria-label': '백업 파일 고르기' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = ''; // 같은 파일을 다시 골라도 change가 나게
    if (f) void restoreBackup(f);
  });
  const restore = h('button', { type: 'button', class: 'j-csv', 'data-testid': 'j-restore', title: '백업 파일을 지금 기록에 합쳐요 (지금 기록은 지워지지 않아요)' }, '파일 고르기');
  restore.addEventListener('click', () => file.click());
  const age = backupAgeText(lastBackupAt(), Date.now());
  const hasClosed = journal.trades.some((t) => t.exit !== null);
  const calendar = renderCalendar(ctx, { view: calView, month: calMonth, day: dayFilter }, {
    view: (v) => {
      calView = v;
      remember(CAL_KEY, v);
      render();
    },
    month: (y, m0) => {
      calMonth = { y, m0 };
      render();
    },
    day: (k) => {
      dayFilter = k;
      showAll = false;
      if (k !== null && tab !== 'list') {
        tab = 'list';
        remember(TAB_KEY, tab);
      }
      render();
    },
  });
  const local = journal.trades.length ? `이 브라우저에만 저장돼요 · ${age ?? '아직 백업 안 함'}` : '이 브라우저에만 저장돼요';
  nav.setOpenCount(journal.trades.filter((t) => t.exit === null).length);
  // 백업·CSV 버튼은 설정 탭 「백업·내보내기」에 모았다 (2026-11-12). 머리글의 안내를 누르면 그리로 간다
  const localBtn = h('button', { type: 'button', class: 'muted small j-local', 'data-testid': 'j-local', title: '백업·내보내기 열기' }, `${local} ›`);
  localBtn.addEventListener('click', () => {
    tab = 'settings';
    remember(TAB_KEY, tab);
    openSettingsSection('data');
    render();
  });
  const settingsDeps = {
    save: () => saveJournal(storage, journal),
    capital: loadSizing(storage).capital,
    backup,
    restore,
    csv,
    backupAge: age,
  };
  root.replaceChildren(
    nav.root,
    h(
      'header',
      { class: 'j-head' },
      // 로고 = 차트(계산기) 화면으로 (2026-11-11)
      h(
        'a',
        { href: '/', class: 'j-brand', 'data-testid': 'j-brand', title: '1RC 차트 화면으로' },
        h('img', { src: '/favicon.svg', alt: '', width: '22', height: '22' }),
        h('b', {}, h('span', { class: 'j-brand-one' }, '1'), 'RC'),
      ),
      h('h1', {}, '📒 매매일지'),
      localBtn,
      file,
    ),
    h(
      'main',
      { class: 'j-main' },
      renderReview(ctx),
      renderOpen(ctx, deleteBtn),
      ...(hasClosed ? [renderNumbers(ctx), calendar, renderCurve(ctx)] : []),
      renderTabs(),
      ...(tab === 'list' ? [renderClosed()] : tab === 'stats' ? [renderSummary(stats), renderLimits(), renderGroups(), renderMonthly()] : [renderSettings(ctx, settingsDeps)]),
    ),
  );
}

// 계산기(다른 탭)에서 기록하면 바로 따라온다
window.addEventListener('storage', (e) => {
  if (e.key === JOURNAL_KEY) render();
});
render();

// 가상 거래 자동 추적 (2026-11-11): 열 때 + 60초마다. 손절·목표에 닿은 열린 거래를 청산한다
let tracking = false;
async function track(): Promise<void> {
  if (tracking || document.hidden) return;
  tracking = true;
  try {
    const closed = await trackOpenTrades({ storage, fetchImpl: netFetch, bases: CONFIG.bybit.restBases, now: () => Date.now() });
    if (closed.length) {
      render();
      for (const t of closed) {
        const r = tradeResult(t);
        alertBox(`${t.symbol.replace(/USDT$/, '')} ${t.side === 'LONG' ? '롱' : '숏'} ${t.auto === 'tp' ? '목표' : '손절'} 닿음 ${fmtR(r?.r ?? null)} · 자동 청산`);
      }
    }
  } finally {
    tracking = false;
  }
}
void track();
window.setInterval(() => void track(), 60_000);
// 진행 중 카드의 지난 시간을 1초마다 다시 쓴다 (카드를 다시 그리지 않아 입력 중인 값이 지워지지 않는다)
window.setInterval(() => {
  if (document.hidden) return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-opened]')) el.textContent = `⏱ ${fmtElapsed(Date.now() - Number(el.dataset.opened))}`;
}, 1000);
document.addEventListener('visibilitychange', () => void track());
