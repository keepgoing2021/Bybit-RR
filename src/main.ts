import './styles.css';
import { CONFIG } from './config';
import { BybitProvider } from './data/bybit/provider';
import type { Scheduler, WebSocketLike } from './data/bybit/socket';
import { safeStorage } from './core/persistence';
import { App } from './ui/app';

const scheduler: Scheduler = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
};

const app = new App({
  root: document.getElementById('app')!,
  storage: safeStorage(() => window.localStorage),
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
