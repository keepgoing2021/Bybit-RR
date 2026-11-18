import type { Candle } from './types';

/**
 * 눌림 알림 (2026-11-18 사용자 로직). 급락·추세전환(PRZ) 구간에서 단기 엔트리를 "보기 시작할" 자리를 잡는다.
 * 변곡 모드에서는 차트도 하이킨아시 봉으로 바꿔 그린다 — 보이는 봉·MA와 계산이 같아야 한다 (2026-11-18 사용자).
 * MA도 하이킨아시 종가로 (트레이딩뷰에서 하이킨아시 차트에 MA를 얹은 것과 같음).
 *
 * 정배열 = MA20이 MA100 위에 올라타 있고 하이킨아시 가격이 둘 다 위, 역배열 = 정반대 (2026-11-19 사용자 정의 확정)
 * 롱: 역배열에서 하이킨아시 양봉 N개+ 파동 → 그 파동 중·직후 정배열 전환
 *     → 음봉 N개 이상 연속 (눌림. 다시 역배열이 되면 무효)
 *     → 다시 첫 양봉(두 번째 양봉 파동) = 신호. 전환 한 번에 한 번만, 전환 후 maxBars봉 안에 완성될 때만.
 * (2026-11-18 수정 이력: 가격 vs MA20 하나·기한 없음 → 고점에서도 뜸, MA20×MA100 크로스 → 사용자 정의와 다름)
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

/** 하이킨아시 값으로 바꾼 캔들 (거래량·마감 여부는 그대로). 차트 표시와 신호 계산이 같이 쓴다 */
export function haCandles(candles: readonly Candle[]): Candle[] {
  const ha = heikinAshi(candles);
  return candles.map((c, i) => ({ ...c, open: ha[i].open, high: ha[i].high, low: ha[i].low, close: ha[i].close }));
}

export type PullbackDir = 'long' | 'short';
/** 매수(롱)·매도(숏) 눌림을 따로 켜고 끈다 */
export type PullbackDirs = Record<PullbackDir, boolean>;

export interface PullbackBar {
  time: number;
  /** 하이킨아시 양봉 (종가 ≥ 시가) */
  green: boolean;
  /** 정배열(up: MA20 > MA100, 가격이 둘 다 위)/역배열(down: 반대). 그 밖이거나 MA가 아직 없으면 null */
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

/** 파동 상태 기계. 순수 함수라 테스트하기 쉽다.
 *  첫 파동은 전환 전(역배열)부터 이어져 와도 된다 — 전환 순간에 지금까지 이어진 봉 수를 거꾸로 세서 시작한다 (2026-11-18 사용자 구조) */
export function detectPullbacks(bars: readonly PullbackBar[], minWave: number, maxBars = Infinity): PullbackSignal[] {
  const out: PullbackSignal[] = [];
  let dir: PullbackDir | null = null;
  let phase: Phase = 'done';
  let waveRun = 0;
  let pullRun = 0;
  let pullFrom = 0;
  let flipAt = 0;
  let prevSide: 'up' | 'down' | null = null;
  // 같은 색이 이어진 봉 수 (지금 봉 포함)와 그 직전 반대색 묶음의 봉 수
  let run = 0;
  let prevRun = 0;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i > 0 && bars[i - 1].green === b.green) run++;
    else {
      prevRun = run;
      run = 1;
    }
    const side = b.side ?? prevSide;
    const flipped = side !== null && prevSide !== null && side !== prevSide;
    if (b.side !== null) prevSide = b.side;

    if (flipped) {
      // 배열이 바뀌면 그 방향으로 새로 센다 (반대쪽 진행 중이던 건 무효)
      dir = side === 'up' ? 'long' : 'short';
      flipAt = i;
      const withTrend = dir === 'long' ? b.green : !b.green;
      if (withTrend) {
        // 첫 파동 진행 중에 전환 — 전환 전부터 이어진 봉까지 센다
        phase = 'wave';
        waveRun = run;
      } else if (prevRun >= minWave) {
        // 첫 파동이 끝나고 눌림이 시작된 뒤 전환
        phase = 'pull';
        pullRun = run;
        pullFrom = i - run + 1;
      } else {
        phase = 'wave';
        waveRun = 0;
      }
      continue;
    }
    if (!dir || phase === 'done') continue;
    // 전환에서 너무 멀어지면 버린다 — 이미 벌어진 추세 한가운데에서 뜨지 않게
    if (i - flipAt > maxBars) {
      phase = 'done';
      continue;
    }

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

const smaAtIndex = (c: readonly Candle[], i: number, p: number): number | null => {
  if (i < p - 1) return null;
  let sum = 0;
  for (let k = i - p + 1; k <= i; k++) sum += c[k].close;
  return sum / p;
};

/** 마감된 봉만으로 신호를 찾는다 — 진행 중인 봉으로 미리 잡으면 표시·알림이 생겼다 사라진다.
 *  MA·상자 범위 모두 하이킨아시 값 (변곡 모드 차트에 보이는 그대로) */
export function pullbackSignals(candles: readonly Candle[], fast = 20, slow = 100, minWave = 3, maxBars = 15): PullbackSignal[] {
  const last = candles[candles.length - 1];
  const closed = haCandles(last && !last.confirmed ? candles.slice(0, -1) : candles);
  const bars: PullbackBar[] = closed.map((c, i) => {
    const f = smaAtIndex(closed, i, fast);
    const sl = smaAtIndex(closed, i, slow);
    return {
      time: c.time,
      green: c.close >= c.open,
      // 정배열 = MA20이 MA100 위 + 하이킨아시 종가가 둘 다 위, 역배열 = MA20이 MA100 아래 + 종가가 둘 다 아래.
      // 그 밖(선 사이에 끼거나 선 순서와 가격이 엇갈림)은 직전 상태 유지 (2026-11-19 사용자: 짧은 MA가 긴 MA 위에 올라탄 게 진짜 정배열)
      side: f === null || sl === null ? null : f > sl && c.close > f ? 'up' : f < sl && c.close < f ? 'down' : null,
    };
  });
  return detectPullbacks(bars, minWave, maxBars).map((s) => {
    const span = closed.slice(s.fromIndex, s.index + 1);
    return {
      ...s,
      price: s.dir === 'long' ? closed[s.index].low : closed[s.index].high,
      high: Math.max(...span.map((c) => c.high)),
      low: Math.min(...span.map((c) => c.low)),
    };
  });
}
