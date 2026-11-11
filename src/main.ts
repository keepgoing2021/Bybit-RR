import './styles.css';
import { CONFIG } from './config';
import { BybitProvider } from './data/bybit/provider';
import type { Scheduler, WebSocketLike } from './data/bybit/socket';
import { safeStorage } from './core/persistence';
import { trackOpenTrades } from './data/virtualTracker';
import { App } from './ui/app';

const scheduler: Scheduler = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
};

const storage = safeStorage(() => window.localStorage);
const app = new App({
  root: document.getElementById('app')!,
  storage,
  now: () => Date.now(),
  createProvider: () =>
    new BybitProvider({
      restBases: [...CONFIG.bybit.restBases],
      wsUrl: CONFIG.bybit.wsUrl,
      fetchImpl: (url) => fetch(url),
      createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
      scheduler,
      now: () => Date.now(),
      pingIntervalMs: CONFIG.pingIntervalMs,
      backoffBaseMs: CONFIG.backoffBaseMs,
      backoffMaxMs: CONFIG.backoffMaxMs,
      socketSilenceMs: CONFIG.socketSilenceMs,
    }),
});

(window as unknown as { __rrDebug: ReturnType<App['debugApi']> }).__rrDebug = app.debugApi();
void app.start();

// 가상 거래 자동 추적 (2026-11-11): 열 때 + 60초마다. 저널의 열린 거래가 손절·목표에 닿았으면 청산한다
let tracking = false;
async function track(): Promise<void> {
  if (tracking || document.hidden) return;
  tracking = true;
  try {
    const closed = await trackOpenTrades({ storage, fetchImpl: (url) => fetch(url), bases: CONFIG.bybit.restBases, now: () => Date.now() });
    if (closed.length) app.journalChanged(closed);
  } finally {
    tracking = false;
  }
}
window.setTimeout(() => void track(), 3_000);
window.setInterval(() => void track(), 60_000);
document.addEventListener('visibilitychange', () => void track());
