import type { Candle } from './types';

/**
 * 눌림 알림 (2026-11-18 사용자 로직). 급락·추세전환(PRZ) 구간에서 단기 엔트리를 "보기 시작할" 자리를 잡는다.
 * 차트 봉은 그대로 두고, 하이킨아시는 계산에만 쓴다.
 *
 * 롱: 하이킨아시 종가가 MA20 아래 → 위 (정배열 전환)
 *     → 하이킨아시 양봉 N개 이상 연속 (첫 파동)
 *     → 음봉 N개 이상 연속 (눌림, 그동안 MA20 위 유지 — 아래로 가면 무효)
 *     → 다시 첫 양봉 = 신호. 전환 한 번에 한 번만.
 * 숏: 정반대.
 */

export interface HaBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 하이킨아시: 종가 = 시고저종 평균, 시가 = 직전 하이킨아시 시가·종가 평균 (첫 봉은 실제 시가·종가 평균) */
export function heikinAshi(candles: readonly Candle[]): HaBar[] {
  const out: HaBar[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: c.time, open, close, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close) });
  }
  return out;
}

export type PullbackDir = 'long' | 'short';

export interface PullbackBar {
  time: number;
  /** 하이킨아시 양봉 (종가 ≥ 시가) */
  green: boolean;
  /** 하이킨아시 종가가 MA 위(up)/아래(down). MA가 아직 없으면 null */
  side: 'up' | 'down' | null;
}

export interface PullbackSignal {
  time: number;
  index: number;
  dir: PullbackDir;
  /** 화살표 기준 가격: 롱은 그 봉 저가, 숏은 고가 (detectPullbacks만 쓰면 0) */
  price: number;
  /** 눌림 구간 시작 (음봉 파동 첫 봉, 숏은 양봉 파동 첫 봉) — 테두리 상자의 왼쪽 */
  fromIndex: number;
  fromTime: number;
  /** 눌림 구간 ~ 신호 봉의 실제 고가·저가 (상자 위아래. detectPullbacks만 쓰면 0) */
  high: number;
  low: number;
}

type Phase = 'wave' | 'pull' | 'done';

/** 파동 상태 기계. 순수 함수라 테스트하기 쉽다 */
export function detectPullbacks(bars: readonly PullbackBar[], minWave: number): PullbackSignal[] {
  const out: PullbackSignal[] = [];
  let dir: PullbackDir | null = null;
  let phase: Phase = 'done';
  let waveRun = 0;
  let pullRun = 0;
  let pullFrom = 0;
  let prevSide: 'up' | 'down' | null = null;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const side = b.side ?? prevSide;
    if (side && prevSide && side !== prevSide) {
      // 배열이 바뀌면 그 방향으로 새로 센다 (반대쪽 진행 중이던 건 무효)
      dir = side === 'up' ? 'long' : 'short';
      phase = 'wave';
      waveRun = 0;
      pullRun = 0;
    }
    if (b.side !== null) prevSide = b.side;
    if (!dir || phase === 'done') continue;

    // 롱: 진행 방향 봉 = 양봉, 눌림 봉 = 음봉. 숏은 반대
    const withTrend = dir === 'long' ? b.green : !b.green;
    if (phase === 'wave') {
      if (withTrend) waveRun++;
      else if (waveRun >= minWave) {
        phase = 'pull';
        pullRun = 1;
        pullFrom = i;
      } else waveRun = 0;
    } else if (phase === 'pull') {
      if (!withTrend) pullRun++;
      else if (pullRun >= minWave) {
        out.push({ time: b.time, index: i, dir, price: 0, fromIndex: pullFrom, fromTime: bars[pullFrom].time, high: 0, low: 0 });
        phase = 'done';
      } else {
        // 눌림이 짧았다 → 이 봉부터 첫 파동을 다시 센다
        phase = 'wave';
        waveRun = 1;
        pullRun = 0;
      }
    }
  }
  return out;
}

/** 마감된 봉만으로 신호를 찾는다 — 진행 중인 봉으로 미리 잡으면 표시·알림이 생겼다 사라진다 */
export function pullbackSignals(candles: readonly Candle[], maPeriod = 20, minWave = 3): PullbackSignal[] {
  const last = candles[candles.length - 1];
  const closed = last && !last.confirmed ? candles.slice(0, -1) : candles;
  const ha = heikinAshi(closed);
  const bars: PullbackBar[] = [];
  let sum = 0;
  for (let i = 0; i < closed.length; i++) {
    // MA는 1RC 차트의 MA20과 같은 값(실제 종가 단순 이동평균)
    sum += closed[i].close;
    if (i >= maPeriod) sum -= closed[i - maPeriod].close;
    const ma = i >= maPeriod - 1 ? sum / maPeriod : null;
    const h = ha[i];
    bars.push({
      time: h.time,
      green: h.close >= h.open,
      side: ma === null || h.close === ma ? null : h.close > ma ? 'up' : 'down',
    });
  }
  return detectPullbacks(bars, minWave).map((s) => {
    const span = closed.slice(s.fromIndex, s.index + 1);
    return {
      ...s,
      price: s.dir === 'long' ? closed[s.index].low : closed[s.index].high,
      high: Math.max(...span.map((c) => c.high)),
      low: Math.min(...span.map((c) => c.low)),
    };
  });
}
