import type { Candle } from './types';

/**
 * 변곡? (2026-11-18~19 사용자 로직). 급락 뒤 추세가 바뀌는지 "보기 시작할" 자리를 두 단계로 잡는다.
 * 변곡 모드에서는 차트도 하이킨아시 봉으로 그린다 — 보이는 봉·MA와 계산이 같아야 한다. MA도 하이킨아시 종가로.
 *
 * 공통 바닥: 확실한 역배열(두 MA가 캔들 위 + MA20 < MA100)에서 하이킨아시 음봉 파동 wave개+ → 이 바닥에서 출발
 * 1차 (최저점 근처, 다소 공격적. 2026-11-19 사용자 정의): 급락으로 "많이" 역배열 — MA100 − MA20 간격이 평균 봉 크기의 gapK배 이상 —
 *     인 상태의 음봉 파동 wave개+ → 하이킨아시 양봉 파동 wave개+ → 음봉 파동 pull개+ → 다시 양봉. 바닥에서 maxBars봉 안. MA20이 MA100을 넘으면 1차는 끝
 * 「변곡? 안정」 (제법 올랐지만 보수적): MA20이 MA100 위 + 가격이 둘 다 위 (정배열)
 *     → maxBars봉 안에 MA20 위에서 버티는 음봉 눌림 pull개+ → 다시 양봉.
 * 바닥 하나에 공격·안정 각 한 번. 매도는 전부 정반대 (값을 뒤집어 같은 계산).
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
/** 매수(롱)·매도(숏)를 따로 켜고 끈다 */
export type PullbackDirs = Record<PullbackDir, boolean>;
/** aggr = 「변곡? 공격」(역배열 바닥 근처), stable = 「변곡? 안정」(정배열 후 MA20 지지) */
export type TurnKind = 'aggr' | 'stable';
/** 화면·알림에 쓰는 이름 (한 곳에서 바꾼다) */
export const TURN_NAME: Record<TurnKind, string> = { aggr: '1차', stable: '2차' };

/** 롱 기준으로 본 봉 하나 (매도는 값을 뒤집어 넣는다) */
export interface TurnBar {
  time: number;
  /** 하이킨아시 양봉 */
  green: boolean;
  /** 하이킨아시 종가 */
  close: number;
  /** MA20 · MA100 (없으면 null) */
  f: number | null;
  s: number | null;
  /** 최근 평균 봉 크기 (고가−저가). 없으면 1차 판단 안 함 */
  ar?: number | null;
}

export interface TurnHit {
  kind: TurnKind;
  index: number;
  /** 눌림 첫 봉 — 테두리 상자의 왼쪽 */
  fromIndex: number;
}

export interface PullbackSignal {
  time: number;
  index: number;
  dir: PullbackDir;
  kind: TurnKind;
  /** 화살표 기준 가격: 롱은 그 봉 저가, 숏은 고가 (하이킨아시) */
  price: number;
  fromIndex: number;
  fromTime: number;
  /** 눌림 구간 ~ 신호 봉의 하이킨아시 고가·저가 (상자 위아래) */
  high: number;
  low: number;
}

export interface TurnOptions {
  /** 바닥 음봉 파동 최소 봉 수 */
  wave: number;
  /** 눌림 음봉 최소 연속 봉 수 */
  pull: number;
  /** 정배열 전환 후 이 봉 수 안에 눌림이 시작돼야 2차 신호 */
  maxBars: number;
  /** 1차: MA100 − MA20 간격이 평균 봉 크기의 몇 배 이상이어야 "많이 역배열"인지 */
  gapK: number;
}

type AggrState = 'off' | 'wave' | 'pull' | 'done';
type StableState = 'off' | 'wait' | 'up' | 'pull' | 'done';

/** 롱 기준 상태 기계. 순수 함수라 테스트하기 쉽다 */
export function detectTurns(bars: readonly TurnBar[], o: TurnOptions): TurnHit[] {
  const out: TurnHit[] = [];
  let aggr: AggrState = 'off';
  let stable: StableState = 'off';
  let aggrWave = 0;
  let aggrAt = 0;
  let aggrRun = 0;
  let aggrFrom = 0;
  let stRun = 0;
  let stFrom = 0;
  let crossAt = 0;
  // 지금 음봉 묶음 안에서 확실한 역배열이었던 봉 수 / 그중 "많이" 역배열(간격 큼)이었던 봉 수
  let downInRun = 0;
  let deepInRun = 0;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const { f, s, close: c } = b;
    if (f === null || s === null) continue;
    const strictDown = f < s && c < f;

    // 바닥: 확실한 역배열 음봉이 wave개 이상 이어지면 이 바닥에서 새로 출발 (2차용)
    // 그중 MA 간격이 크게 벌어진(급락) 음봉이 wave개 이상이면 1차도 출발
    const deep = strictDown && b.ar != null && b.ar > 0 && s - f >= o.gapK * b.ar;
    if (b.green) {
      downInRun = 0;
      deepInRun = 0;
    } else if (strictDown) {
      downInRun++;
      if (deep) deepInRun++;
      if (deepInRun >= o.wave) {
        aggr = 'wave';
        aggrWave = 0;
        aggrAt = i;
      }
      if (downInRun >= o.wave) {
        stable = 'wait';
        continue;
      }
    }

    // 1차: MA20 < MA100 동안만. 음봉 파동(바닥) → 양봉 파동 → 음봉 파동 → 다시 양봉
    if (aggr === 'wave' || aggr === 'pull') {
      // 바닥(마지막 급락 음봉)에서 maxBars봉 안에 끝나야 "최저점 근처"
      if (f >= s || i - aggrAt > o.maxBars) aggr = 'done';
      else if (aggr === 'wave') {
        if (b.green) aggrWave++;
        else if (aggrWave >= o.wave) {
          aggr = 'pull';
          aggrRun = 1;
          aggrFrom = i;
        } else aggrWave = 0;
      } else if (!b.green) aggrRun++;
      else if (aggrRun >= o.pull) {
        out.push({ kind: 'aggr', index: i, fromIndex: aggrFrom });
        aggr = 'done';
      } else {
        // 음봉 파동이 짧았다 → 이 봉부터 양봉 파동을 다시 센다
        aggr = 'wave';
        aggrWave = 1;
      }
    }

    // 안정: 정배열 (MA20 > MA100 + 가격이 둘 다 위)
    if (stable !== 'off' && stable !== 'done') {
      if (stable === 'wait') {
        if (f > s && c > f) {
          stable = 'up';
          crossAt = i;
        }
      } else if (f <= s) stable = 'wait';
      else if (stable === 'up') {
        if (i - crossAt > o.maxBars) stable = 'done';
        else if (!b.green) {
          if (c >= f) {
            stable = 'pull';
            stRun = 1;
            stFrom = i;
          } else stable = 'wait';
        }
      } else if (stable === 'pull') {
        if (!b.green) {
          if (c >= f) stRun++;
          else stable = 'wait';
        } else if (stRun >= o.pull && c >= f) {
          out.push({ kind: 'stable', index: i, fromIndex: stFrom });
          stable = 'done';
        } else stable = 'up';
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

/** 마감된 봉만으로 신호를 찾는다 — 진행 중인 봉으로 미리 잡으면 표시·알림이 생겼다 사라진다 */
export function pullbackSignals(
  candles: readonly Candle[],
  fast = 20,
  slow = 100,
  opts: TurnOptions = { wave: 3, pull: 2, maxBars: 15, gapK: 2 },
): PullbackSignal[] {
  const last = candles[candles.length - 1];
  const ha = haCandles(last && !last.confirmed ? candles.slice(0, -1) : candles);
  const f = ha.map((_, i) => smaAtIndex(ha, i, fast));
  const s = ha.map((_, i) => smaAtIndex(ha, i, slow));
  // 평균 봉 크기: 하이킨아시 고가−저가의 최근 20봉 평균
  const ranges = ha.map((c) => ({ close: c.high - c.low }) as Candle);
  const ar = ha.map((_, i) => smaAtIndex(ranges, i, 20));
  const out: PullbackSignal[] = [];
  for (const dir of ['long', 'short'] as const) {
    // 매도는 값을 뒤집어(음수) 롱과 같은 계산
    const k = dir === 'long' ? 1 : -1;
    const bars: TurnBar[] = ha.map((c, i) => ({
      time: c.time,
      green: dir === 'long' ? c.close >= c.open : c.close <= c.open,
      close: k * c.close,
      f: f[i] === null ? null : k * f[i]!,
      s: s[i] === null ? null : k * s[i]!,
      ar: ar[i],
    }));
    for (const h of detectTurns(bars, opts)) {
      const span = ha.slice(h.fromIndex, h.index + 1);
      out.push({
        time: ha[h.index].time,
        index: h.index,
        dir,
        kind: h.kind,
        price: dir === 'long' ? ha[h.index].low : ha[h.index].high,
        fromIndex: h.fromIndex,
        fromTime: ha[h.fromIndex].time,
        high: Math.max(...span.map((x) => x.high)),
        low: Math.min(...span.map((x) => x.low)),
      });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
