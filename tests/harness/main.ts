// 자동 테스트(E2E) 전용 진입점. 배포되는 앱(index.html → src/main.ts)에는 들어가지 않는다.
// 앱을 그대로 띄우되 시세만 시드 고정 가짜 시세로 바꾸고, 시간을 ?speed= 배속으로 돌린다.
import '../../src/styles.css';
import type { Scheduler } from '../../src/data/bybit/socket';
import { safeStorage } from '../../src/core/persistence';
import { App, TOUR_KEY } from '../../src/ui/app';
import { DemoProvider } from '../fixtures/demo/provider';

const params = new URLSearchParams(location.search);
const speed = Math.min(600, Math.max(1, Number(params.get('speed')) || 1));

const scheduler: Scheduler = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
};

// 가짜 시세의 시계: 페이지를 연 시각부터 speed 배속으로 흐른다
// 첫 사용 안내는 ?tour 가 있을 때만 (다른 테스트에서는 이미 본 것으로 둔다)
if (!params.has('tour')) {
  try {
    localStorage.setItem(TOUR_KEY, '1');
  } catch {
    // 무시
  }
}

const t0 = Date.now();
const fakeNow = () => t0 + (Date.now() - t0) * speed;
let provider: DemoProvider | null = null;

const app = new App({
  root: document.getElementById('app')!,
  storage: safeStorage(() => window.localStorage),
  now: () => Date.now(),
  createProvider: () => (provider = new DemoProvider({ now: fakeNow, realNow: () => Date.now(), scheduler, tickMs: 250 })),
});

const w = window as unknown as {
  __rrDebug: ReturnType<App['debugApi']>;
  __rrTest: { disconnect(ms: number): void };
};
w.__rrDebug = app.debugApi();
w.__rrTest = { disconnect: (ms) => provider?.simulateDisconnect(ms) };
void app.start();
