import '../styles.css';
import './journal.css';
import {
  computeStats, groupStats, JOURNAL_KEY, limitStatus, MAX_RULES, MIN_GROUP_TRADES, QUALITY_LABEL, sessionOf, toCsv, tradeResult,
  type Journal, type Stats, type Trade,
} from '../core/journal';
import { safeStorage } from '../core/persistence';
import { h, setText } from '../ui/dom';
import { loadJournal, saveJournal } from '../ui/journalForm';

/**
 * 1rc.app/journal — 거래 저널 (2026-11-06). 계산기와 같은 브라우저 저장소(rrtool.v1.journal)를 쓴다.
 * 숫자 요약 · 손실 한도 신호등 · 진행 중(청산가만 넣기) · 끝난 거래 · 잘/못 되는 곳(10건 이상) · 설정 · CSV
 */
const storage = safeStorage(() => window.localStorage);
const root = document.getElementById('app')!;
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

const fmtR = (r: number | null) => (r === null ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(2)}R`);
const fmtPct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const fmtUsd = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const sign = (v: number | null) => (v === null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');

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

function renderOpen(): HTMLElement {
  const open = journal.trades.filter((t) => t.exit === null).sort((a, b) => b.openedAt - a.openedAt);
  const rows = open.map((t) => {
    const exit = h('input', { class: 'j-exit num', inputmode: 'decimal', placeholder: '청산가', 'aria-label': `${t.symbol} 청산가`, 'data-testid': `j-exit-${t.id}` });
    const close = h('button', { type: 'button', class: 'j-close', 'data-testid': `j-close-${t.id}` }, '청산');
    const doClose = () => {
      const v = Number(exit.value.replace(/[,\s]/g, ''));
      if (!(Number.isFinite(v) && v > 0)) {
        alertBox('청산가를 숫자로 넣어 주세요.');
        return;
      }
      t.exit = v;
      t.closedAt = Date.now();
      persist();
    };
    close.addEventListener('click', doClose);
    exit.addEventListener('keydown', (e) => e.key === 'Enter' && doClose());
    // 손절·목표 자리로 바로
    const quick = (label: string, price: number | null) => {
      if (price === null) return null;
      const b = h('button', { type: 'button', class: 'j-quick' }, label);
      b.addEventListener('click', () => {
        exit.value = String(price);
        doClose();
      });
      return b;
    };
    return h(
      'div',
      { class: 'j-open-row', 'data-testid': 'j-open-row' },
      h('div', { class: 'j-open-main' }, h('b', { 'data-side': t.side }, `${t.symbol.replace(/USDT$/, '')} ${t.side === 'LONG' ? '롱' : '숏'}`), h('span', { class: 'muted' }, `${fmtTime(t.openedAt)} · ${t.setup || '셋업 없음'} · ${QUALITY_LABEL[t.quality]}`)),
      h('div', { class: 'j-open-prices num' }, `진입 ${t.entry} · 손절 ${t.sl}${t.tp !== null ? ` · 목표 ${t.tp}` : ''}`),
      t.reason ? h('div', { class: 'j-reason' }, t.reason) : null,
      h('div', { class: 'j-open-actions' }, exit, close, quick('손절가로', t.sl), quick('목표가로', t.tp), deleteBtn(t)),
    );
  });
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-open' },
    h('h2', {}, `진행 중 ${open.length}`),
    rows.length ? h('div', { class: 'j-open' }, ...rows) : h('p', { class: 'muted' }, '계산기에서 LONG/SHORT 계산 후 「📒 저널에 기록」을 누르면 여기 나와요.'),
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
  const closed = journal.trades.filter((t) => t.exit !== null).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const list = showAll ? closed : closed.slice(0, 30);
  const head = h('tr', {}, ...['청산', '종목', '셋업', '품질', '세션', 'R', '순손익', '근거', ''].map((x) => h('th', {}, x)));
  const rows = list.map((t) => {
    const res = tradeResult(t);
    return h(
      'tr',
      { 'data-outcome': res?.outcome ?? '' },
      h('td', { class: 'num' }, t.closedAt ? fmtTime(t.closedAt) : ''),
      h('td', {}, h('b', { 'data-side': t.side }, `${t.symbol.replace(/USDT$/, '')} ${t.side === 'LONG' ? '롱' : '숏'}`)),
      h('td', {}, t.setup || '—'),
      h('td', { 'data-q': t.quality }, QUALITY_LABEL[t.quality]),
      h('td', {}, sessionOf(t.openedAt)),
      h('td', { class: 'num', 'data-sign': sign(res?.r ?? null) }, fmtR(res?.r ?? null)),
      h('td', { class: 'num', 'data-sign': sign(res?.pnl ?? null) }, res?.pnl != null ? fmtUsd(res.pnl) : '—'),
      h('td', { class: 'j-reason-cell', title: t.reason }, t.reason),
      h('td', {}, deleteBtn(t)),
    );
  });
  const more = closed.length > 30 ? h('button', { type: 'button', class: 'link' }, showAll ? '최근 30건만' : `전부 보기 (${closed.length}건)`) : null;
  more?.addEventListener('click', () => {
    showAll = !showAll;
    render();
  });
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-closed' },
    h('h2', {}, `끝난 거래 ${closed.length}`),
    closed.length ? h('div', { class: 'j-table-wrap' }, h('table', { class: 'j-table' }, h('thead', {}, head), h('tbody', {}, ...rows))) : h('p', { class: 'muted' }, '청산가를 넣으면 R·순손익(수수료 뺌)이 자동으로 계산돼요.'),
    more,
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

function renderSettings(): HTMLElement {
  const s = journal.settings;
  const lines = (v: string[]) => v.join('\n');
  const setups = h('textarea', { rows: '5', 'data-testid': 'j-set-setups' }, lines(s.setups));
  const rules = h('textarea', { rows: '6', 'data-testid': 'j-set-rules' }, lines(s.rules));
  const num = (v: number, step = '1', id = '') => h('input', { type: 'number', min: '0', step, value: String(v), 'data-testid': id, class: 'num' });
  const maxTrades = num(s.daily.maxTradesPerDay, '1', 'j-set-max');
  const stopAfter = num(s.daily.stopAfterLosses, '1', 'j-set-stop');
  const lDay = num(s.limits.daily, '0.5');
  const lWeek = num(s.limits.weekly, '0.5');
  const lMonth = num(s.limits.monthly, '0.5');
  const arOn = h('input', { type: 'checkbox', 'data-testid': 'j-set-ar' });
  arOn.checked = s.autoRisk.enabled;
  const arBase = num(s.autoRisk.basePct, '0.1');
  const arUp = num(s.autoRisk.upPct, '0.1');
  const arTh = num(s.autoRisk.thresholdPct, '0.5');
  const save = h('button', { type: 'button', class: 'j-save', 'data-testid': 'j-set-save' }, '설정 저장');
  save.addEventListener('click', () => {
    const list = (t: HTMLTextAreaElement, max: number) => [...new Set(t.value.split('\n').map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, max);
    const n = (i: HTMLInputElement, fb: number) => (Number.isFinite(Number(i.value)) && Number(i.value) >= 0 ? Number(i.value) : fb);
    journal.settings = {
      setups: list(setups, 30),
      rules: list(rules, MAX_RULES),
      daily: { maxTradesPerDay: Math.round(n(maxTrades, 0)), stopAfterLosses: Math.round(n(stopAfter, 0)) },
      limits: { daily: n(lDay, 0), weekly: n(lWeek, 0), monthly: n(lMonth, 0) },
      autoRisk: { enabled: arOn.checked, basePct: n(arBase, 0.5) || 0.5, upPct: n(arUp, 1) || 1, thresholdPct: n(arTh, 2) },
    };
    persist();
    alertBox('설정을 저장했어요. 계산기에도 바로 적용돼요.');
  });
  const field = (label: string, control: HTMLElement, hint = '') => h('label', { class: 'j-field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
  return h(
    'section',
    { class: 'j-section', 'data-testid': 'j-settings' },
    h('h2', {}, '설정 (처음 한 번만)'),
    h(
      'div',
      { class: 'j-settings' },
      field('셋업 목록', setups, '한 줄에 하나. 계산기에서 고를 수 있어요'),
      field(`나의 진입 규칙 (최대 ${MAX_RULES}개)`, rules, '한 줄에 하나. 기록할 때 체크해요'),
      h(
        'div',
        { class: 'j-field-group' },
        h('b', {}, '하루 운영 규칙'),
        field('하루 최대 거래 수', maxTrades, '0 = 끔'),
        field('연속 손절 몇 번이면 중단', stopAfter, '0 = 끔'),
      ),
      h('div', { class: 'j-field-group' }, h('b', {}, '손실 한도 (R)'), field('하루', lDay), field('한 주', lWeek), field('한 달', lMonth)),
      h(
        'div',
        { class: 'j-field-group' },
        h('b', {}, '리스크 자동 조절'),
        h('label', { class: 'j-check' }, arOn, '켜기 (계산기 「손실 %」를 자동으로 바꿔요, 총 자산을 넣었을 때만)'),
        field('평소 위험 %', arBase),
        field('수익 쌓이면 위험 %', arUp),
        field('누적 수익률 기준 %', arTh, '총 자산 대비 저널 누적 순손익이 이 이상이면 높은 %로'),
      ),
    ),
    save,
  );
}

function render(): void {
  journal = loadJournal(storage);
  const stats = computeStats(journal.trades);
  const csv = h('button', { type: 'button', class: 'j-csv', 'data-testid': 'j-csv' }, 'CSV 내보내기');
  csv.addEventListener('click', () => {
    // 엑셀에서 한글이 깨지지 않게 BOM
    const blob = new Blob(['﻿' + toCsv(journal.trades)], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `1rc-journal-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  root.replaceChildren(
    h(
      'header',
      { class: 'j-head' },
      h('a', { href: '/', class: 'j-back', 'data-testid': 'j-back' }, '← 계산기'),
      h('h1', {}, '📒 거래 저널'),
      h('span', { class: 'muted small j-local' }, '이 브라우저에만 저장돼요'),
      csv,
    ),
    h('main', { class: 'j-main' }, renderSummary(stats), renderLimits(), renderOpen(), renderClosed(), renderGroups(), renderSettings()),
  );
}

// 계산기(다른 탭)에서 기록하면 바로 따라온다
window.addEventListener('storage', (e) => {
  if (e.key === JOURNAL_KEY) render();
});
render();

