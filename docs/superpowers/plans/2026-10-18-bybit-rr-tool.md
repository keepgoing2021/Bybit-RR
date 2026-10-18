# Bybit 선물 RR 툴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LONG/SHORT 클릭 순간의 체결가를 엔트리로 고정하고 가격 구조로 SL·TP를 제안·수정하며 RR을 실시간 표시하는 Bybit 선물용 웹 차트 툴 MVP.

**Architecture:** 판단 로직은 전부 `src/core`의 순수 함수(테스트 대상), 시세는 `src/data`의 교체 가능한 공급원(Bybit/데모), 차트는 Lightweight Charts 위에 시리즈 프리미티브로 박스를 그리고 드래그는 순수 컨트롤러가 담당. UI는 프레임워크 없이 DOM으로 연결.

**Tech Stack:** TypeScript, Vite 8, lightweight-charts 5.2.1, Vitest 5 (+jsdom 불필요), @playwright/test 1.64 (E2E, 데모 데이터).

**Spec:** `docs/superpowers/specs/2026-10-18-bybit-rr-tool-design.md` (상위: `2026-10-18-original-request.md`)

## Global Constraints

- RR은 결과값이다. 어떤 코드도 목표 RR로 TP/SL을 계산하지 않는다.
- 무효한 자동 SL/TP는 `price=null` + 사유. 다른 후보로 몰래 대체하지 않는다.
- SL 수정은 TP·엔트리를, TP 수정은 SL·엔트리를 바꾸지 않는다.
- 모든 가격은 종목 tickSize로 스냅. RR은 틱 정수로 계산해 부동소수 오차를 피한다.
- 자동 선정 입력은 `isClosedBy(candle, tf, cutoff)`를 통과한 캔들만.
- UI 문구는 한국어. "가격 기준 · 수수료·슬리피지·레버리지 미반영 · 가상 시나리오" 상시 표시.
- 데모 데이터일 때 "DEMO 데이터" 배지 상시 표시, 종목명 `DEMO-` 접두사.
- 시간 단위: 내부 ms(UTC epoch), Lightweight Charts에는 초 단위로 전달.

## Review Focus

1. Bybit REST가 막힘(CORS·지역·네트워크) → 상태 표시에 오류 원인이 보이고 앱이 죽지 않으며 데모로 전환 가능해야 함. → Task 10 `fetchCandles rejects with status`.
2. tickSize가 매우 작은 종목(0.0000001) → 소수 자릿수·스냅이 정확해야 함. → Task 1 `decimalsOf handles 1e-7`.
3. 활성 시나리오 중 종목/시간봉 전환 → 다른 종목 차트에 섞이지 않음. → Task 12 E2E `switching symbol hides scenario`.
4. 캔들 로드 전·0개에서 LONG 클릭 → "데이터 부족" 사유, 크래시 없음. → Task 5 `empty candles gives unavailable SL`.
5. localStorage 사용 불가(사생활 보호 모드 throw)·손상 → 크래시 없이 초기 상태. → Task 6 `storage that throws`.

---

### Task 1: Scaffold, timeframe, price utils

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/core/types.ts`, `src/core/timeframe.ts`, `src/core/price.ts`; Test `tests/unit/timeframe.test.ts`, `tests/unit/price.test.ts`

**Interfaces — Produces:**
- `types.ts`: `Side = 'LONG'|'SHORT'`; `Timeframe = '1'|'3'|'5'|'15'|'30'|'60'|'120'|'240'|'360'|'720'|'D'|'W'`; `Candle {time:number; open:number; high:number; low:number; close:number; volume:number; confirmed:boolean}` (time = 시작 ms); `SymbolInfo {symbol:string; tickSize:number}`; `PriceTick {price:number; time:number; source:'trade'|'ticker'}`
- `timeframe.ts`: `TIMEFRAMES: Timeframe[]`, `tfMs(tf):number`, `tfLabel(tf):string`, `defaultHigherTf(tf):Timeframe|null` (spec D10 표), `higherTimeframes(tf):Timeframe[]`, `isClosedBy(c:Candle, tf:Timeframe, cutoffMs:number):boolean` = `c.confirmed && c.time + tfMs(tf) <= cutoffMs`
- `price.ts`: `decimalsOf(tick):number`, `snapToTick(p, tick):number`, `ticksBetween(a, b, tick):number`, `formatPrice(p, tick):string`

- [ ] Step 1: tests — `tfMs('15')===900000`, `tfMs('D')===86400000`, `tfMs('W')===604800000`; `defaultHigherTf('15')==='60'`, `('240')==='D'`, `('720')==='W'`, `('W')===null`; `higherTimeframes('60')` equals `['120','240','360','720','D','W']`; `isClosedBy({time:0,confirmed:true},'1',60000)` true, cutoff 59999 false, confirmed false → false. `snapToTick(97.33,0.5)===97.5`, `snapToTick(97.3,0.1)===97.3`, `decimalsOf(0.5)===1`, `decimalsOf(1)===0`, `decimalsOf(0.0001)===4`, `decimalsOf(1e-7)===7`, `ticksBetween(100,97,0.1)===30`, `formatPrice(1234.5,0.01)==='1234.50'`.
- [ ] Step 2: `npx vitest run tests/unit/timeframe.test.ts tests/unit/price.test.ts` → FAIL (modules missing)
- [ ] Step 3: implement. `snapToTick` = `Number((Math.round(p/tick)*tick).toFixed(decimalsOf(tick)))`.
- [ ] Step 4: same command → PASS
- [ ] Step 5: commit `feat: scaffold, timeframe and price utils`

### Task 2: RR metrics

**Files:** Create `src/core/metrics.ts`; Test `tests/unit/metrics.test.ts`

**Interfaces — Produces:** `computeMetrics(i: {side:Side; entry:number; sl:number|null; tp:number|null; current:number|null; tickSize:number}): Metrics` where `Metrics {valid:boolean; reasons:string[]; riskDist:number|null; rewardDist:number|null; riskTicks:number|null; rewardTicks:number|null; riskPct:number|null; rewardPct:number|null; rr:number|null; currentR:number|null; currentPct:number|null}`; `formatRR(rr:number):string` → `'1:3'`, `'1:1.53'` (소수 2자리, 끝 0 제거)

- [ ] Step 1: tests (tick 0.01) — `LONG 100/98/106 → rr 3, riskPct 2, rewardPct 6`; `LONG 100/97/106 → rr 2`; `LONG 100/97/109 → rr 3`; `SHORT 100/102/94 → rr 3`; `LONG current 101, sl 98 → currentR 0.5, currentPct 1`; `SHORT current 99, sl 102 → currentR 0.5, currentPct 1`; `sl null → valid false, rr null, reasons contains 'SL 미설정'`; `LONG sl 100 → reasons contains '위험 거리가 0'`; `LONG tp 99 → reasons contains 'TP는 엔트리보다 높아야'`; `SHORT sl 99 → reasons contains 'SL은 엔트리보다 높아야'`, currentR null; `formatRR(3)==='1:3'`, `formatRR(1.5257)==='1:1.53'`.
- [ ] Step 2: run → FAIL
- [ ] Step 3: implement; rr = rewardTicks / riskTicks.
- [ ] Step 4: run → PASS
- [ ] Step 5: commit `feat: RR metrics`

### Task 3: ATR and spike candle

**Files:** Create `src/core/atr.ts`, `src/core/spike.ts`; Test `tests/unit/atr.test.ts`, `tests/unit/spike.test.ts`

**Interfaces — Produces:** `trueRange(c:Candle, prev?:Candle):number`; `atrSeries(candles, period, method:'wilder'|'sma'):(number|null)[]` (Wilder: TR[0]=H−L, atr[period−1]=평균, 이후 `(prev*(p−1)+TR)/p`); `selectSpikeCandle(candles, opts:{lookback:number; atrPeriod:number; atrMethod:'wilder'|'sma'}): SpikeResult|null`, `SpikeResult {index:number; candle:Candle; score:number; atr:number; evaluated:number}`

- [ ] Step 1: tests — TR with gap uses prev close; wilder seed = mean of first `period` TRs and next value follows recursion; sma window mean; spike picks max range/ATR(i−1); `its own range does not feed its ATR` (후보 자신의 TR이 분모에 들어가면 순위가 바뀌는 데이터); `tie picks more recent`; `candidate outside lookback ignored`; `returns null when no candidate has prior ATR`; `skips zero ATR`.
- [ ] Step 2: run → FAIL; Step 3: implement; Step 4: run → PASS; Step 5: commit `feat: ATR and spike candle selection`

### Task 4: Swings and TP target

**Files:** Create `src/core/swing.ts`; Test `tests/unit/swing.test.ts`

**Interfaces — Produces:** `Swing {kind:'high'|'low'; index:number; time:number; price:number; confirmIndex:number}`; `findSwings(candles, bars):Swing[]` (고점: 왼쪽 `bars`개보다 엄격히 큼, 오른쪽 `bars`개 이상; 저점 대칭; confirmIndex=index+bars; 오름차순); `selectSwingTarget(side, swings, entry, mode:'latest'|'beyondEntry'): {swing:Swing|null; status:'ok'|'invalid'|'unavailable'; reason:string|null}` (LONG은 high, SHORT는 low)

- [ ] Step 1: tests — highs `[1,2,5,5,3,2]` bars 2 → pivot index 2 only; last `bars` candles never pivots; low pivot symmetric; LONG latest high > entry → ok; latest high < entry, mode latest → invalid, reason contains '유효한 자동 TP 없음'; mode beyondEntry → older high above entry; no swings → unavailable.
- [ ] Step 2–5 as above; commit `feat: swing detection and TP target`

### Task 5: Settings and auto-level analysis

**Files:** Create `src/core/settings.ts`, `src/core/analysis.ts`; Test `tests/unit/analysis.test.ts`, `tests/unit/settings.test.ts`

**Interfaces — Consumes:** Task 1 `isClosedBy`, `snapToTick`; Task 3 `selectSpikeCandle`; Task 4 `findSwings`, `selectSwingTarget`.
**Produces:** `AnalysisSettings {lookback:number; atrPeriod:number; atrMethod:'wilder'|'sma'; slBufferTicks:number; swingBars:number; tpMode:'latest'|'beyondEntry'; boxExtendBars:number; staleAfterSec:number; maxPriceAgeSec:number}`; `DEFAULT_SETTINGS` = `{50,14,'wilder',0,2,'latest',10,15,60}`; `sanitizeSettings(x:unknown):AnalysisSettings` (범위 clamp: lookback 5–500, atrPeriod 2–200, slBufferTicks 0–10000, swingBars 1–20, boxExtendBars 0–200, staleAfterSec 3–300, maxPriceAgeSec 5–3600; 잘못된 값은 기본값)
`AutoSL {price:number|null; candidatePrice:number|null; status:'ok'|'invalid'|'unavailable'; reason:string|null; candle:Candle|null; score:number|null; atr:number|null; timeframe:Timeframe; bufferTicks:number}`; `AutoTP {price; candidatePrice; status; reason; swing:{time:number; price:number; confirmedAt:number}|null; timeframe:Timeframe|null}`; `AutoLevels {sl:AutoSL; tp:AutoTP}`; `analyzeAutoLevels(i:{side; entry; cutoff:number; tickSize; ltf:{timeframe; candles}; htf:{timeframe; candles}|null; settings}): AutoLevels`

- [ ] Step 1: tests — `LONG SL is spike candle low`; `buffer 3 ticks lowers LONG SL by 3 ticks`; `SHORT SL is spike high plus buffer`; `bigger spike after cutoff is ignored`; `unconfirmed candle is ignored`; `LONG SL at or above entry is invalid` (price null, candidatePrice set, reason '유효한 자동 SL 없음'); `empty candles gives unavailable SL` (reason contains '데이터 부족'); `TP is latest confirmed HTF swing high`; `swing confirmed after cutoff is not used`; `htf null gives unavailable TP`. Settings: defaults; clamps; garbage → defaults.
- [ ] Step 2–5; commit `feat: auto SL/TP analysis`

### Task 6: Scenario state and persistence

**Files:** Create `src/core/scenario.ts`, `src/core/persistence.ts`; Test `tests/unit/scenario.test.ts`, `tests/unit/persistence.test.ts`

**Interfaces — Produces:** `Scenario {version:1; id:string; symbol:string; timeframe:Timeframe; htf:Timeframe|null; side:Side; entry:number; tickSize:number; clickedAt:number; priceTime:number; priceSource:'trade'|'ticker'; auto:AutoLevels; applied:{sl:number|null; tp:number|null}; source:{sl:'auto'|'manual'; tp:'auto'|'manual'}; settings:AnalysisSettings; status:'active'|'closed'; closed:{price:number; time:number}|null}`; `createScenario(i): Scenario`; `setLevel(s, which:'sl'|'tp', price:number|null): Scenario`; `restoreAuto(s): Scenario`; `closeScenario(s, at:{price; time}): Scenario`.
`StorageLike {getItem(k):string|null; setItem(k,v):void; removeItem(k):void}`; `UiSelection {provider:'bybit'|'demo'; symbol:string; timeframe:Timeframe; htf:Timeframe|null}`; `PersistedState {version:1; scenario:Scenario|null; ui:UiSelection|null}`; `saveState(st, s)`, `loadState(st):PersistedState|null`, `saveSettings(st, s)`, `loadSettings(st):AnalysisSettings`. Keys `rrtool.v1.state`, `rrtool.v1.settings`.

- [ ] Step 1: tests — `create applies auto prices and marks auto`; `setLevel sl keeps entry and tp, marks manual, snaps`; `spec example flow` (100/98/106 rr 3 → sl 97 rr 2 tp 106 → tp 109 rr 3 sl 97); `restoreAuto returns creation-time auto values and keeps entry`; `close freezes`; persistence `roundtrip`, `corrupt JSON returns null`, `wrong version returns null`, `storage that throws` (load → null, save no throw), `loadSettings sanitizes`.
- [ ] Step 2–5; commit `feat: scenario state and persistence`

### Task 7: Freshness and entry capture

**Files:** Create `src/core/freshness.ts`; Test `tests/unit/freshness.test.ts`

**Interfaces — Produces:** `FeedSnapshot {socketOpen:boolean; lastMessage:{ts:number; receivedAt:number}|null; lastPrice:PriceTick|null}`; `evaluateFreshness(f, now, o:{staleAfterMs; maxPriceAgeMs}): {status:'connecting'|'live'|'stale'|'disconnected'; canCreate:boolean; reason:string|null; priceAgeMs:number|null}` (서버 현재 추정 = lastMessage.ts + (now − receivedAt), 가격 나이 = 추정 − lastPrice.time); `captureEntry(f, now, o): {ok:true; price; priceTime; source; clickedAt} | {ok:false; reason:string}`

- [ ] Step 1: tests — closed socket → disconnected/canCreate false; open but no message → connecting; last message older than 15s → stale; age example (ts 1000, receivedAt 5000, now 6000, price.time 1500 → priceAgeMs 500); age > max → canCreate false, reason contains '오래된'; capture returns price/priceTime/clickedAt=now; no price → ok false.
- [ ] Step 2–5; commit `feat: freshness and entry capture`

### Task 8: Bybit parsing and candle store

**Files:** Create `src/data/bybit/parse.ts`, `src/data/candleStore.ts`; Test `tests/unit/bybitParse.test.ts`, `tests/unit/candleStore.test.ts` (fixtures = 공식 문서 예시 구조)

**Interfaces — Produces:** `parseKlineList(list:string[][], serverTime:number, tf:Timeframe): Candle[]` (오름차순, confirmed = time+tfMs ≤ serverTime); `parseInstruments(list:unknown[]): SymbolInfo[]` (D1 필터); `WsEvent = {type:'kline'; topic; candles:Candle[]} | {type:'trade'; topic; ticks:PriceTick[]} | {type:'ticker'; topic; lastPrice:number|null; ts:number} | {type:'pong'} | {type:'ack'; success:boolean; message:string} | {type:'unknown'}`; `parseWsMessage(raw:string): {event:WsEvent; ts:number|null}`. `class CandleStore {setAll(c); upsert(c):'append'|'update'|'insert'; merge(c[]); all():readonly Candle[]; last()}` (merge: 같은 time이면 confirmed 우선, 아니면 새 값)

- [ ] Step 1: tests per interfaces incl. doc fixtures (REST 3 candles newest-first → ascending; WS kline confirm false; trade p "16578.50" → 16578.5, T; ticker delta without lastPrice → null; pong; ack).
- [ ] Step 2–5; commit `feat: bybit parsing and candle store`

### Task 9: Reconnecting socket

**Files:** Create `src/data/bybit/socket.ts`, `tests/unit/helpers/fakes.ts`; Test `tests/unit/socket.test.ts`

**Interfaces — Produces:** `WebSocketLike {readyState:number; send(d:string):void; close():void; onopen; onclose; onerror; onmessage}`; `Scheduler {setTimeout; clearTimeout; setInterval; clearInterval}`; `SocketState = 'idle'|'connecting'|'open'|'reconnecting'|'closed'`; `class ReconnectingSocket(opts:{url; createSocket:(url)=>WebSocketLike; scheduler; pingIntervalMs:number; backoffBaseMs:number; backoffMaxMs:number})` with `connect()`, `close()`, `setTopics(t:string[])`, `onMessage(cb)`, `onStateChange(cb)`.

- [ ] Step 1: tests — `subscribes topics on open`; `pings every interval`; `reconnects with 1s then 2s backoff`; `backoff capped at max`; `backoff resets after open`; `resubscribes after reconnect`; `setTopics sends unsubscribe and subscribe diff`; `close stops reconnecting`.
- [ ] Step 2–5; commit `feat: reconnecting websocket`

### Task 10: Providers (Bybit, Demo)

**Files:** Create `src/data/provider.ts`, `src/data/bybit/provider.ts`, `src/data/demo/generator.ts`, `src/data/demo/provider.ts`, `src/config.ts`; Test `tests/unit/bybitProvider.test.ts`, `tests/unit/demo.test.ts`

**Interfaces — Consumes:** Task 8, Task 9. **Produces:** `FeedListener {onCandle(c:Candle):void; onPrice(t:PriceTick):void; onMessage(ts:number|null, receivedAt:number):void; onSocketState(s:SocketState):void; onReconnected():void}`; `MarketDataProvider {kind:'bybit'|'demo'; isDemo:boolean; listSymbols():Promise<SymbolInfo[]>; fetchCandles(symbol, tf, limit):Promise<{candles:Candle[]; serverTime:number}>; watch(symbol, tf, l:FeedListener):()=>void; simulateDisconnect?(ms:number):void}`; `new BybitProvider({restBase; wsUrl; fetchImpl; createSocket; scheduler})`; `new DemoProvider({now:()=>number; scheduler; tickMs?:number})`; `demoCandles(seed, tf, endTime, count):Candle[]`.

- [ ] Step 1: tests — Bybit: URL `…/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=1000`; `fetchCandles rejects with status` (HTTP 403 → Error message contains '403'); retCode≠0 → reject with retMsg; `listSymbols follows cursor`; `watch subscribes kline, publicTrade, tickers topics`; trade message → onPrice; kline → onCandle; reconnect → onReconnected. Demo: deterministic; OHLC sanity; last candle unconfirmed; watch emits prices on schedule; simulateDisconnect → socket state 'closed' then 'open'.
- [ ] Step 2–5; commit `feat: bybit and demo providers`

### Task 11: Box geometry and drag controller

**Files:** Create `src/chart/geometry.ts`, `src/chart/drag.ts`; Test `tests/unit/geometry.test.ts`, `tests/unit/drag.test.ts`

**Interfaces — Produces:** `CoordMapper {priceToY(p):number|null; logicalToX(l):number|null}`; `BoxInput {side; entry; sl:number|null; tp:number|null; startLogical:number; endLogical:number}`; `Rect {x; y; w; h}`; `BoxGeometry {x1; x2; yEntry; ySl:number|null; yTp:number|null; profit:Rect|null; loss:Rect|null; handles:{sl:Rect|null; tp:Rect|null}}`; `computeBoxGeometry(i, m):BoxGeometry|null`; `hitTest(g, x, y, tol=6):'sl'|'tp'|null`; `class DragController({getGeometry; yToPrice; snap; onDrag(which, price); setChartInteraction(enabled:boolean)})` with `pointerDown(x,y):boolean`, `pointerMove(x,y):void`, `pointerUp():void`, `isDragging():boolean`.

- [ ] Step 1: tests — LONG profit above entry / loss below; SHORT reversed; null sl → loss null; hit within 6px → 'sl'; outside x range → null; handle hit; nearest wins; drag disables then re-enables interaction; move calls onDrag with snapped price; miss → false; `drag updates RR in real time` (DragController + setLevel + computeMetrics: 100/98/106, y→97.5 → rr 2.4, y→97 → rr 2, tp 106 unchanged).
- [ ] Step 2–5; commit `feat: box geometry and drag controller`

### Task 12: Chart view, UI, app wiring, E2E

**Files:** Create `src/chart/rrPrimitive.ts`, `src/chart/chartView.ts`, `src/ui/app.ts`, `src/ui/dom.ts`, `src/ui/format.ts`, `src/styles.css`, `src/main.ts`, `playwright.config.ts`; Test `tests/unit/format.test.ts`, `tests/e2e/app.spec.ts`

**Interfaces — Consumes:** Tasks 1–11. **Produces:** `window.__rrDebug` (읽기 전용): `getScenario()`, `getMetrics()`, `getRenderedGeometry()`, `computeExpectedGeometry()`, `priceToClientY(p)`, `getFeedStatus()`. `format.ts`: `formatTime(ms):string` (현지 `MM-DD HH:mm`), `slRationale(auto:AutoSL):string` 예 `SL: 15분봉 10-18 14:15 캔들 저가`, `tpRationale(auto:AutoTP):string` 예 `TP: 4시간봉 확정 스윙 고점 (10-17 08:00)`.

- [ ] Step 1: unit tests for `format.ts` rationale strings; E2E tests (demo, `?source=demo`): `entry stays fixed while price moves`; `dragging SL updates RR during drag and keeps TP`; `geometry matches coordinates after zoom and scroll`; `reload restores scenario and manual edits`; `restore auto returns creation values`; `disconnect blocks creation and reconnect recovers`; `second LONG asks instead of overwriting`; `manual input snaps to tick`; `switching symbol hides scenario`.
- [ ] Step 2: run unit + e2e → FAIL
- [ ] Step 3: implement chart view (candles, price lines, primitive, markers, drag wiring with capture-phase pointer listeners), UI (상단바/패널/설정/대화상자), app state.
- [ ] Step 4: `npm test && npm run build && npm run e2e` → PASS
- [ ] Step 5: commit `feat: chart view and app UI`

### Task 13: Bybit check script, README, verification report

**Files:** Create `scripts/check-bybit.mjs`, `README.md`, `docs/verification.md`

- [ ] Step 1: `scripts/check-bybit.mjs` (Node 22 내장 fetch/WebSocket): 종목정보(BTCUSDT tickSize), 15분봉 200개(정렬·개수), WS 구독 후 15초 내 trade·kline·pong 수신 여부를 항목별 PASS/FAIL 출력, 실패 시 종료코드 1.
- [ ] Step 2: `node scripts/check-bybit.mjs` 실행 → 이 환경에선 네트워크 차단으로 FAIL 예상(기록만).
- [ ] Step 3: README(설치·실행·구조·선정 이유·초기 가정·검증표), verification.md(명령과 결과, 미검증 항목 명시).
- [ ] Step 4: commit `docs: README, verification report, bybit check script`
