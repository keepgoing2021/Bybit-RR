# 저널 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저널 첫 화면을 「할 일(청산 카드) → 숫자 3개 → 달력 → 곡선 → 탭」으로 바꾸고, 청산 칩·주간 리뷰·점수·연속 기록을 더한다.

**Architecture:** 계산은 전부 화면 없는 순수 함수(`src/core/journalInsights.ts`)로 두고 vitest로 고정한다. 저장 형식은 `version: 1`에 선택 항목만 더한다. 화면은 `src/journal/main.ts`를 얇게 만들고 조각 파일로 나눈다.

**Tech Stack:** TypeScript, Vite, vitest, Playwright, 기존 `h()` DOM 도우미(`src/ui/dom`). 새 라이브러리 없음.

**Spec:** `docs/superpowers/specs/2026-11-11-journal-redesign-design.md`

**분량 메모:** 사용자가 토큰을 아껴 달라고 해서, 구현 코드는 계획에 통째로 적지 않고 함수 이름·타입·시험 사례(입력 → 기대값)를 정확히 적는다. 시험을 먼저 쓰고(실패 확인) 구현한다.

## Global Constraints

- 데이터는 localStorage에만. 외부 통신·새 의존성 없음.
- 사용자 글(리뷰, 셋업, 근거)은 `h()`의 글자 자식 또는 `textContent`로만 넣는다. `innerHTML` 금지.
- 날짜·주 경계는 한국 시간(기존 `periodStart`).
- 기존 testid 유지: `j-open`(글 「진행 중 N」), `j-closed`(글 「끝난 거래 N」), `j-exit-<id>`, `j-close-<id>`, `j-local`, `j-backup`, `j-restore`, `j-restore-file`, `j-csv`, `j-set-*`. 기존 `tests/e2e/journal.spec.ts`는 고치지 않고 통과해야 한다.
- 예전 저널·예전 백업 파일은 그대로 읽혀야 한다.
- 커밋 작성자 `keepgoing2021 <89294486+keepgoing2021@users.noreply.github.com>`, 메시지 끝에 `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- 실행: `npm test`(vitest), `npm run typecheck`, e2e는 `PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx playwright test tests/e2e/journal*.spec.ts`.
- main 푸시·배포는 사용자가 「배포해」라고 한 뒤에만.

## Review Focus

1. 칩이 없는 예전 거래만 있는 저널 → 첫 화면이 깨지지 않고 점수 「거래 10개부터」 또는 숫자, 연속 기록 0일. (Task 2 시험)
2. 계산기 탭이 저널을 다시 저장해도 `reviews`가 사라지지 않는다 → `parseJournal`→`JSON.stringify` 왕복 시험. (Task 1)
3. 백업 파일에 손댄 값(`closeRule: "<img>"`, 300자 리뷰, 숫자가 아닌 `weekStart`) → 그 항목만 버리고 나머지는 읽는다. (Task 1)
4. 자정·주 경계(한국 시간 일요일 23:59 vs 월요일 00:00)에 청산한 거래가 맞는 날·주에 들어간다. (Task 2)
5. 손절폭 0 등으로 `tradeResult`가 null인 청산 거래 → 달력·점수·곡선에서 조용히 빠지고 예외가 나지 않는다. (Task 2)

---

### Task 1: 저장 형식 (칩 · 리뷰)

**Files:** Modify `src/core/journal.ts`; Test `tests/unit/journal.test.ts`

**Produces:**
```ts
export type CloseRule = 'kept' | 'movedSl' | 'earlyExit' | 'noPlan';
export type Mood = 'calm' | 'rushed' | 'revenge' | 'tired';
export const CLOSE_RULE_LABEL: Record<CloseRule, string>; // 지켰다 / 손절 옮김 / 일찍 청산 / 계획 없이 진입
export const MOOD_LABEL: Record<Mood, string>;            // 차분 / 조급 / 복수심 / 피곤
// Trade에 추가: closeRule?: CloseRule; mood?: Mood;
export interface WeeklyReview { weekStart: number; pattern: string; fix: string; writtenAt: number }
// Journal에 추가: reviews?: WeeklyReview[];
export const REVIEW_MAX_CHARS = 200;
export function isRuleBreak(t: Trade): boolean; // quality==='break' || (closeRule !== undefined && closeRule !== 'kept')
export function upsertReview(j: Journal, r: WeeklyReview): void; // 같은 weekStart는 바꿔 넣음, 글은 200자로 자름
```

- [ ] 시험 추가 (실패 확인: `npm test -- journal.test`)
  - `parseJournal`: `closeRule:'movedSl', mood:'tired'` 유지 / `closeRule:'<img>'`, `mood:5` → 항목 없음(`'closeRule' in trade === false`), 거래는 살아 있음
  - `parseJournal`: `reviews`에 정상 1개 + `weekStart:'x'` 1개 + `pattern` 300자 1개 → 2개 남고 300자는 200자로 잘림. `reviews`가 없는 예전 데이터 → `reviews` 는 `[]`
  - 왕복: `parseJournal(JSON.stringify(parseJournal(raw)))`가 칩·리뷰를 그대로 유지
  - `isRuleBreak`: (rule, 칩 없음)=false, (break)=true, (rule, kept)=false, (rule, earlyExit)=true
  - `computeStats`: 거래 4개 중 `earlyExit` 1개 → `ruleBreaks` 1, `rcr` 0.75
  - `toBackup`→`parseBackup`: 리뷰·칩 유지. `reviews` 없는 예전 백업 문자열 → `ok: true`
  - `mergeJournal`: 같은 주 리뷰는 `writtenAt` 큰 쪽, 다른 주는 둘 다. 같은 id 거래에서 지금 것에 칩이 없고 백업에 있으면 칩만 가져온다
  - `toCsv`: 머리줄 끝에 `청산 때 규칙`, `그때 상태`; 값은 한글 라벨, 없으면 빈칸
- [ ] 구현: `parseTrade`에서 목록에 있는 값일 때만 항목을 넣는다. `parseReviews(v)` 추가(숫자 `weekStart`/`writtenAt`, 글은 `str(x, 200)`, 주마다 하나, 최대 520개). `parseJournal`·`parseBackup`·`toBackup`·`mergeJournal`·`computeStats`·`toCsv` 반영.
- [ ] `npm test && npm run typecheck` 통과 → 커밋 `feat(journal): close chips and weekly reviews in storage`

### Task 2: 계산 (`journalInsights.ts`)

**Files:** Create `src/core/journalInsights.ts`; Test `tests/unit/journalInsights.test.ts`

**Consumes:** Task 1의 타입, `tradeResult`, `periodStart`, `sessionOf`, `isRuleBreak`.

**Produces:**
```ts
export function dayKey(ms: number): string;                       // 한국 날짜 'YYYY-MM-DD'
export function dailyTotals(trades: Trade[]): Map<string, { r: number; n: number }>; // closedAt 기준
export function monthCells(year: number, month0: number): (string | null)[];  // 일요일 시작, 앞쪽 빈칸은 null
export function lastDayKeys(now: number, n: number): string[];    // 오래된 날 → 오늘
export interface Score { total: number; profit: number; rules: number; loss: number; consistency: number }
export const SCORE_MIN_TRADES = 10;
export function score(trades: Trade[], now: number): Score | null; // 최근 30일, 10개 미만이면 null
export function recordStreak(trades: Trade[]): number;
export function weakestSpot(trades: Trade[], min?: number): { label: string; r: number } | null; // min 기본 5
export function cumulativeR(trades: Trade[]): number[];           // 청산 순서대로 누적
export function maxDrawdownR(trades: Trade[]): number;            // 양수, 없으면 0
export function maxStreaks(trades: Trade[]): { win: number; loss: number };
export function avgHoldMs(trades: Trade[]): number | null;
export interface MonthRow { key: string; trades: number; winRate: number | null; totalR: number } // key 'YYYY-MM'
export function monthlyRows(trades: Trade[]): MonthRow[];         // 최근 달 먼저
export interface WeekSummary { trades: number; winRate: number | null; totalR: number; kept: number }
export function weekSummary(trades: Trade[], weekStart: number): WeekSummary;
export function pendingReviewWeek(j: Journal, now: number): number | null; // 지난 주 시작. 그 주에 청산 거래가 있고 리뷰가 없을 때만
export function currentFix(j: Journal, now: number): string | null;        // 지난 주 리뷰의 fix (빈 글이면 null)
```
`tradeResult`가 null인 거래는 모든 함수에서 뺀다.

- [ ] 시험 작성 (실패 확인)
  - `dayKey(Date.UTC(2026,10,8,14,59))`='2026-11-08', `dayKey(Date.UTC(2026,10,8,15,0))`='2026-11-09'
  - `dailyTotals`: 같은 날 +2R, −1R → `{r:1, n:2}`; 열린 거래·손절폭 0 거래는 빠짐
  - `monthCells(2026, 10)`: 길이 30(11/1이 일요일), 첫 칸 '2026-11-01'. `monthCells(2026, 11)`: 앞에 null 2개
  - `score`: 9개 → null. 10개 전부 +1R·`kept`·`calm` → total 100. 10개 전부 −1R(손절 지킴), 칩 없음, quality rule → profit 0, rules 25, loss 25, consistency 0 → 50. −2R 손실 5개 + −1R 5개 → loss 12.5(반올림은 total에서만). 31일 전 거래는 세지 않음
  - `recordStreak`: 빈 저널 0. 3일 연속 칩 다 채움 → 3. 가운데 날 한 거래에 `mood` 없음 → 최근 날부터 세서 1. 거래 없는 날이 사이에 있어도 이어짐
  - `weakestSpot`: 「런던 숏」 5개 합 −3R, 「아시아 롱」 5개 합 +2R → `{label:'런던 · 숏', r:-3}`. 전부 4개씩 → null. 전부 플러스 → null. 셋업 묶음이 더 낮으면 `'셋업: <이름>'`
  - `cumulativeR` [+1,−1,+2] → [1,0,2]; `maxDrawdownR` [+2,−1,−1,+3] → 2; `maxStreaks` W W L L L W → {win:2, loss:3} (본전은 양쪽 다 끊음)
  - `avgHoldMs`: 1시간·3시간 → 2시간. 없으면 null
  - `monthlyRows`: 10월 2개·11월 1개 → 11월이 먼저
  - `weekSummary`: 일요일 23:59 KST 청산은 그 주, 월요일 00:00 KST 청산은 다음 주
  - `pendingReviewWeek`: 지난 주 거래 있음+리뷰 없음 → 지난 주 시작값. 리뷰 있음 → null. 지난 주 거래 없음 → null
  - `currentFix`: 지난 주 리뷰 fix '손절 옮기지 않기' → 그 글. 2주 전 리뷰만 있으면 null
- [ ] 구현 → `npm test && npm run typecheck` → 커밋 `feat(journal): insights (calendar, score, streak, weakest spot)`

### Task 3: 화면 나누기 + 첫 화면 뼈대 + 청산 카드

**Files:** Modify `src/journal/main.ts`, `src/journal/journal.css`; Create `src/journal/ctx.ts`, `src/journal/format.ts`, `src/journal/closeCard.ts`, `src/journal/home.ts`, `src/journal/tabs.ts`

**Produces:**
```ts
// ctx.ts
export interface Ctx { journal: Journal; persist(): void; rerender(): void; toast(msg: string): void; now(): number }
// format.ts : fmtR, fmtPct, fmtUsd, fmtTime, sign (main.ts에서 옮김)
// closeCard.ts
export function renderOpen(ctx: Ctx, deleteBtn: (t: Trade) => HTMLElement): HTMLElement;
export function chipRow<T extends string>(name: string, labels: Record<T, string>, value: T | undefined, onPick: (v: T | undefined) => void, testid: string): HTMLElement;
// home.ts
export function renderHome(ctx: Ctx): HTMLElement; // 숫자 3개 (Task 4·5가 달력·리뷰·곡선을 여기에 더함)
// tabs.ts
export type Tab = 'list' | 'stats' | 'settings';
export function renderTabs(active: Tab, onPick: (t: Tab) => void): HTMLElement;
```

화면 순서: `header` → `[review 자리]` → `j-open` → 숫자 3개(`j-score`, `j-streak`, `j-week-r`) → `[달력 자리]` → `[곡선 자리]` → 탭(`j-tab-list` 기본 / `j-tab-stats` / `j-tab-settings`). 탭 내용: 거래 목록 = `j-closed`; 통계 = 요약·손실 한도·잘/못 되는 곳; 설정 = 기존 설정. 고른 탭은 `rrtool.v1.journalTab`에 기억.

청산 카드: 청산가 입력 → 아래에 결과 R 미리보기(`j-preview-<id>`, `grossR` 대신 임시 복사본에 `tradeResult`) → 칩 두 줄(`j-rule-<id>-<값>`, `j-mood-<id>-<값>`, `aria-pressed`, 같은 칩 다시 누르면 해제) → `j-close-<id>` 버튼 글 「저장」. 청산가가 숫자가 아니거나 0 이하면 버튼 `disabled` + 칸 아래 「청산가를 숫자로 넣어 주세요」. 「손절가로」「목표가로」는 칸만 채운다. Enter = 저장.
거래 목록 행: 「규칙·상태」 칸에 라벨 또는 「채우기」 버튼(`j-fill-<id>`) → 그 행 아래에 칩 두 줄이 펼쳐지고 누르면 바로 저장.
거래가 하나도 없으면 숫자·달력·곡선 대신 「계산기에서 첫 거래를 저널로 보내 보세요」 한 줄.

- [ ] e2e 먼저: `tests/e2e/journalHome.spec.ts` — 열린 거래 1개 심기 → 청산가 `104` 입력 → 미리보기에 `R` → `j-rule-b-kept`, `j-mood-b-calm` 클릭 → `j-close-b` → localStorage의 그 거래에 `exit:104, closeRule:'kept', mood:'calm'`; `j-streak`에 `1일`. 청산가 `abc` → 버튼 disabled. 실패 확인.
- [ ] 구현 (기존 그리기 함수는 내용 그대로 옮기기만) → `npm run typecheck`, `npm test`, e2e `journal.spec.ts`(기존 2개) + 새 시험 통과 → 커밋 `feat(journal): home layout, close card with chips, tabs`

### Task 4: 달력 + 곡선 + 가장 약한 곳

**Files:** Create `src/journal/calendar.ts`, `src/journal/curve.ts`; Modify `home.ts`, `main.ts`, `journal.css`

**Produces:**
```ts
export function renderCalendar(ctx: Ctx, state: { view: 'strip' | 'month'; month: { y: number; m0: number }; day: string | null }, on: { view(v: 'strip' | 'month'): void; month(y: number, m0: number): void; day(k: string | null): void }): HTMLElement;
export function renderCurve(ctx: Ctx): HTMLElement | null; // 청산 거래 2개 미만이면 null
```
띠: 최근 28일 칸(`j-strip`), 칸마다 `title="11/5 +2.1R"`와 `aria-label`. 「달력 전체 보기」(`j-cal-toggle`) → 한 달(`j-cal`), 칸 `j-day-<YYYY-MM-DD>`에 날짜와 R 합계, `‹ ›`로 달 이동, 「4주만 보기」로 접기. 형태는 `rrtool.v1.journalCalView`에 기억(읽기 실패·모르는 값 → `strip`). 색만으로 구분하지 않게 칸에 `+`/`−` 부호가 든 글을 넣는다. 날짜를 누르면 `j-closed`가 그날 청산 거래만 보이고 제목 옆에 「11/5만 보는 중 · 전체 보기」(`j-day-clear`); 탭은 거래 목록으로 바뀐다.
곡선: `<svg>` `polyline`(`j-curve`), 0선 점선, 아래에 「가장 약한 곳: … −3.1R」(`j-weak`, 없으면 줄 없음).

- [ ] e2e 추가: 청산 거래 2개(다른 날) 심기 → `j-cal-toggle` → `j-day-<날>`에 `+2.00R` → 새로고침 후에도 `j-cal` 보임 → 날짜 클릭 → `j-closed`에 「끝난 거래 1」 → `j-day-clear` → 「끝난 거래 2」. 실패 확인.
- [ ] 구현 → 전체 시험 → 커밋 `feat(journal): calendar (4-week strip / month) and cumulative R curve`

### Task 5: 주간 리뷰 카드

**Files:** Create `src/journal/review.ts`; Modify `home.ts`, `journal.css`

**Produces:** `export function renderReview(ctx: Ctx): HTMLElement | null;`
- `pendingReviewWeek`가 값이면 카드(`j-review`): 「지난 주 돌아보기」, 요약 한 줄(`n거래 · 승률 x% · 합계 ±yR · 규칙 준수 k/n`), 입력 2개(`j-review-pattern`, `j-review-fix`, `maxlength=200`), 「저장」(`j-review-save`). 두 칸 다 비면 저장 막음. 저장 = `upsertReview` + `persist`.
- 아니고 `currentFix`가 있으면 한 줄(`j-fix`): 「이번 주 고칠 것 하나 · <글>」.
- 둘 다 아니면 null.

- [ ] e2e 추가: 8일 전(지난 주가 되도록 `periodStart` 기준으로 날짜 계산) 청산 거래 심기 → `j-review` 보임 → fix에 `<b>손절</b> 옮기지 않기` 입력·저장 → `j-fix`에 그 글이 글자 그대로 보이고 `j-fix b` 요소는 0개 → 새로고침 후에도 보임. 실패 확인.
- [ ] 구현 → 전체 시험 → 커밋 `feat(journal): weekly review card`

### Task 6: 통계 탭 추가 + 좁은 화면

**Files:** Modify `src/journal/main.ts`(통계 탭), `journal.css`

- 요약 카드에 3개 추가: 최대 낙폭 `−x.xxR`, 연속 `n승 / m패`(최대), 평균 보유 `h시간 m분`.
- 월별 표(`j-monthly`): 달 · 거래 · 승률 · 합계 R.
- 390px: 숫자 3개 한 줄, 달력 칸 최소 40px, 칩 줄바꿈, 가로 스크롤 없음.

- [ ] e2e 추가: 화면 390×844에서 `document.documentElement.scrollWidth <= 390`; 통계 탭에서 `j-monthly`에 `2026-11` 행. 실패 확인.
- [ ] 구현 → 커밋 `feat(journal): drawdown, streaks, holding time, monthly table`

### Task 7: 전체 확인

- [ ] `npm test`, `npm run typecheck`, `npm run build`, e2e `journal*.spec.ts` + `review1111.spec.ts` 전부 통과 (기존에 깨져 있던 `app.spec.ts`·`mobile.spec.ts` 9개는 이번 범위 밖 — 새로 깨진 게 없는지만 비교)
- [ ] `npm run dev`로 띄워 예시 데이터로 첫 화면·달력·리뷰 화면을 390px와 1280px에서 캡처 → 사용자에게 Discord로 보냄
- [ ] 사용자 「배포해」 → `git fetch` 후 origin/main과 비교 → main에 합치고 푸시 → 태그 `r-2026-11-11-journal` → 실서비스 `/journal` 확인
