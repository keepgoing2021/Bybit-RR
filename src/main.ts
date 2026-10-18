import './styles.css';
import { CONFIG } from './config';
import { BybitProvider } from './data/bybit/provider';
import type { Scheduler, WebSocketLike } from './data/bybit/socket';
import { DemoProvider } from './data/demo/provider';
import { App, type SourceKind } from './ui/app';

const params = new URLSearchParams(location.search);
const sourceParam = params.get('source');
const sourceOverride: SourceKind | null = sourceParam === 'demo' || sourceParam === 'bybit' ? sourceParam : null;
const demoSpeed = Math.min(600, Math.max(1, Number(params.get('demoSpeed')) || 1));

const scheduler: Scheduler = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
};

// 데모 시계: 페이지를 연 시각부터 demoSpeed 배속으로 흐른다
const demoT0 = Date.now();
const demoNow = () => demoT0 + (Date.now() - demoT0) * demoSpeed;

const app = new App({
  root: document.getElementById('app')!,
  storage: window.localStorage,
  now: () => Date.now(),
  sourceOverride,
  createProvider: (kind) =>
    kind === 'demo'
      ? new DemoProvider({ now: demoNow, realNow: () => Date.now(), scheduler, tickMs: CONFIG.demoTickMs })
      : new BybitProvider({
          restBase: CONFIG.bybit.restBase,
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
