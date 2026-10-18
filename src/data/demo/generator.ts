import { snapToTick } from '../../core/price';
import { tfMs } from '../../core/timeframe';
import type { Candle, Timeframe } from '../../core/types';

/**
 * 데모 데이터: 시드 고정 합성 가격. 실제 시장 데이터가 아니다.
 * 모든 시간봉이 같은 가격 함수에서 나오므로 시간봉끼리 대체로 일관된다.
 */
export const DEMO_SYMBOLS = [
  { symbol: 'DEMO-BTC', tickSize: 0.1, seed: 1, base: 65_000 },
  { symbol: 'DEMO-ETH', tickSize: 0.01, seed: 2, base: 3_200 },
  { symbol: 'DEMO-SOL', tickSize: 0.001, seed: 3, base: 150 },
] as const;

export function demoSymbolInfo(symbol: string) {
  return DEMO_SYMBOLS.find((s) => s.symbol === symbol) ?? null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const SCALES: [number, number][] = [
  [7 * 24 * HOUR, 0.06],
  [24 * HOUR, 0.025],
  [4 * HOUR, 0.01],
  [HOUR, 0.005],
  [15 * MIN, 0.0025],
  [3 * MIN, 0.0012],
  [20_000, 0.0005],
];
const SPIKE_BUCKET = 2 * HOUR;

function hash01(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

function valueNoise(t: number, period: number, seed: number): number {
  const x = t / period;
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash01(i, seed) * 2 - 1;
  const b = hash01(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

/** 2시간마다 35% 확률로 ±1.2% 이내의 급변(약 20초에 걸쳐 튀고 45분에 걸쳐 되돌림) */
function spikes(t: number, seed: number): number {
  let sum = 0;
  const b0 = Math.floor(t / SPIKE_BUCKET);
  for (let b = b0 - 1; b <= b0; b++) {
    if (hash01(b, seed + 999) >= 0.35) continue;
    const t0 = b * SPIKE_BUCKET + hash01(b, seed + 1001) * SPIKE_BUCKET;
    if (t < t0) continue;
    const amp = (hash01(b, seed + 1003) - 0.5) * 2 * 0.012;
    const dt = t - t0;
    sum += amp * (1 - Math.exp(-dt / 20_000)) * Math.exp(-dt / (45 * MIN));
  }
  return sum;
}

export function demoPrice(seed: number, base: number, t: number): number {
  let log = 0;
  SCALES.forEach(([period, amp], k) => {
    log += amp * valueNoise(t, period, seed * 31 + k);
  });
  return base * Math.exp(log + spikes(t, seed));
}

/** [start, min(start+길이, until)] 구간의 캔들. until이 구간 끝 이전이면 진행 중(미확정) 캔들 */
export function demoCandleAt(
  seed: number, base: number, tf: Timeframe, start: number, until: number, tickSize: number,
): Candle {
  const dur = tfMs(tf);
  const end = Math.min(start + dur, until);
  const samples = Math.min(240, Math.max(30, Math.round(dur / MIN)));
  const step = (end - start) / samples;
  const open = snapToTick(demoPrice(seed, base, start), tickSize);
  const close = snapToTick(demoPrice(seed, base, end), tickSize);
  let high = Math.max(open, close);
  let low = Math.min(open, close);
  for (let k = 1; k < samples; k++) {
    const p = snapToTick(demoPrice(seed, base, start + k * step), tickSize);
    if (p > high) high = p;
    if (p < low) low = p;
  }
  return { time: start, open, high, low, close, volume: 0, confirmed: start + dur <= until };
}

export function demoCandles(
  seed: number, tf: Timeframe, endTime: number, count: number, tickSize: number, base?: number,
): Candle[] {
  const b = base ?? DEMO_SYMBOLS.find((s) => s.seed === seed)?.base ?? 100;
  const dur = tfMs(tf);
  const last = Math.floor(endTime / dur) * dur;
  const out: Candle[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(demoCandleAt(seed, b, tf, last - i * dur, endTime, tickSize));
  return out;
}
