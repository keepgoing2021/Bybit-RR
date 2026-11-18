import { describe, expect, it } from 'vitest';
import { detectTurns, haCandles, heikinAshi, pullbackSignals, type TurnBar } from '../../src/core/pullback';
import type { Candle } from '../../src/core/types';

// 봉 한 글자 = 하이킨아시 색 + 종가와 MA20(f)·MA100(s) 위치 (롱 기준). 평균 봉 크기는 1
//  많이 역배열(f 90 < s 100, 간격 10 ≥ 2×1): R 음봉 80(급락)  g 양봉 85  r 음봉 84
//  살짝 역배열(f 99 < s 100, 간격 1 < 2):   W 음봉 90(두 MA 아래지만 간격 작음)  w 양봉 95  v 음봉 94
//  정배열(f 110 > s 100): U 양봉 115(둘 다 위)  q 음봉 112(MA20 위)  y 음봉 105(MA20 아래로 마감)
const CODE: Record<string, [boolean, number, number, number]> = {
  R: [false, 80, 90, 100],
  g: [true, 85, 90, 100],
  r: [false, 84, 90, 100],
  W: [false, 90, 99, 100],
  w: [true, 95, 99, 100],
  v: [false, 94, 99, 100],
  U: [true, 115, 110, 100],
  q: [false, 112, 110, 100],
  y: [false, 105, 110, 100],
};
function bars(code: string): TurnBar[] {
  return [...code].map((ch, i) => {
    const [green, close, f, s] = CODE[ch];
    return { time: i * 60_000, green, close, f, s, ar: 1 };
  });
}
const OPT = { wave: 3, pull: 2, maxBars: 15, gapK: 2 };
const at = (code: string) => detectTurns(bars(code), OPT).map((s) => `${s.kind}@${s.index}`);

describe('detectTurns — 1차 (급락으로 많이 역배열 → 양봉 파동 → 음봉 파동 → 다시 양봉)', () => {
  it('급락 음봉 3 → 양봉 3 → 음봉 2 → 양봉 = 1차', () => {
    expect(at('RRRgggrrg')).toEqual(['aggr@8']);
  });

  it('상자는 음봉 파동 첫 봉부터 신호 봉까지', () => {
    const [s] = detectTurns(bars('RRRgggrrg'), OPT);
    expect([s.fromIndex, s.index]).toEqual([6, 8]);
  });

  it('MA 간격이 작은 역배열(급락 아님)이면 1차 없음', () => {
    expect(at('WWWwwwvvw')).toEqual([]);
  });

  it('양봉 파동이 3개 미만이면 1차 없음', () => {
    expect(at('RRRggrrg')).toEqual([]);
  });

  it('음봉 파동이 1개뿐이면 그 양봉부터 양봉 파동을 다시 센다', () => {
    expect(at('RRRgggrg')).toEqual([]);
    expect(at('RRRgggrgggrrg')).toEqual(['aggr@12']);
  });

  it('바닥에서 15봉 넘게 지나서 완성되면 1차 아님 (최저점 근처만)', () => {
    expect(at(`RRR${'g'.repeat(13)}rrg`)).toEqual([]);
    expect(at(`RRR${'g'.repeat(10)}rrg`)).toEqual(['aggr@15']);
  });

  it('바닥 하나에 1차는 한 번만', () => {
    expect(at('RRRgggrrgggrrg')).toEqual(['aggr@8']);
  });

  it('MA20이 MA100을 넘으면 1차는 끝 (2차만 남음)', () => {
    expect(at('RRRgggUqqU')).toEqual(['stable@9']);
  });

  it('1차 → 2차 둘 다 나올 수 있다', () => {
    expect(at('RRRgggrrgUUqqU')).toEqual(['aggr@8', 'stable@13']);
  });
});

describe('detectTurns — 2차 (정배열 후 MA20 지지)', () => {
  it('역배열 음봉 3 → 정배열(MA20 > MA100, 가격 둘 다 위) → MA20 위 음봉 2 → 양봉 = 안정 신호', () => {
    expect(at('RRRgggUUqqU')).toEqual(['stable@10']);
  });

  it('눌림 중 MA20 아래로 마감하면 무효', () => {
    expect(at('RRRUUqyU')).toEqual([]);
  });

  it('정배열 전환 후 15봉 넘어서 시작한 눌림은 안 셈 (한참 오른 뒤 금지)', () => {
    expect(at(`RRR${'U'.repeat(17)}qqU`)).toEqual([]);
    expect(at(`RRR${'U'.repeat(10)}qqU`)).toEqual(['stable@15']);
  });

  it('바닥(역배열 음봉 파동) 없이 처음부터 정배열이면 신호 없음', () => {
    expect(at('UUUqqU')).toEqual([]);
  });

  it('바닥 하나에 안정도 한 번만', () => {
    expect(at('RRRUUqqUqqU')).toEqual(['stable@7']);
  });
});

describe('haCandles', () => {
  it('하이킨아시 값으로 바꾸고 거래량·마감 여부는 그대로', () => {
    const c: Candle[] = [
      { time: 0, open: 10, high: 14, low: 8, close: 12, volume: 5, confirmed: true },
      { time: 1, open: 12, high: 16, low: 11, close: 15, volume: 7, confirmed: false },
    ];
    expect(haCandles(c)[1]).toEqual({ time: 1, open: 11, high: 16, low: 11, close: 13.5, volume: 7, confirmed: false });
  });
});

describe('heikinAshi', () => {
  it('종가 = 시고저종 평균, 시가 = 직전 하이킨아시 시가·종가 평균 (첫 봉은 실제 시가·종가 평균)', () => {
    const c: Candle[] = [
      { time: 0, open: 10, high: 14, low: 8, close: 12, volume: 1, confirmed: true },
      { time: 1, open: 12, high: 16, low: 11, close: 15, volume: 1, confirmed: true },
    ];
    const ha = heikinAshi(c);
    expect(ha[0]).toMatchObject({ open: 11, close: 11 });
    expect(ha[1]).toMatchObject({ open: 11, close: 13.5, high: 16, low: 11 });
  });
});

describe('pullbackSignals — 실제 캔들 (매수·매도 대칭, 마감 봉만)', () => {
  function path(closes: number[]): Candle[] {
    return closes.map((c, i) => {
      const o = i === 0 ? c : closes[i - 1];
      return { time: i * 60_000, open: o, close: c, high: Math.max(o, c), low: Math.min(o, c), volume: 1, confirmed: true };
    });
  }
  // 120봉 하락 → 25봉 급등 → 5봉 눌림 → 4봉 반등
  const up = (() => {
    const a = Array.from({ length: 120 }, (_, i) => 200 - i * 0.8);
    let p = a[a.length - 1];
    for (let i = 0; i < 25; i++) a.push((p += 3));
    for (let i = 0; i < 5; i++) a.push((p -= 2));
    for (let i = 0; i < 4; i++) a.push((p += 3));
    return a;
  })();

  it('하락 뒤 반등·눌림이면 매수 신호가 나오고, 거울 모양이면 같은 자리에 매도 신호', () => {
    const longs = pullbackSignals(path(up));
    expect(longs.length).toBeGreaterThan(0);
    expect(longs.every((s) => s.dir === 'long')).toBe(true);
    const shorts = pullbackSignals(path(up.map((x) => 400 - x)));
    expect(shorts.map((s) => `${s.kind}@${s.index}`)).toEqual(longs.map((s) => `${s.kind}@${s.index}`));
    expect(shorts.every((s) => s.dir === 'short')).toBe(true);
  });

  it('상자 범위는 하이킨아시 고가·저가', () => {
    const ha = haCandles(path(up));
    for (const s of pullbackSignals(path(up))) {
      const span = ha.slice(s.fromIndex, s.index + 1);
      expect(s.high).toBe(Math.max(...span.map((x) => x.high)));
      expect(s.low).toBe(Math.min(...span.map((x) => x.low)));
    }
  });

  it('진행 중인 봉으로는 신호를 만들지 않는다', () => {
    const all = pullbackSignals(path(up));
    const last = all[all.length - 1];
    const upTo = path(up).slice(0, last.index + 1);
    expect(pullbackSignals(upTo).some((s) => s.index === last.index)).toBe(true);
    upTo[upTo.length - 1] = { ...upTo[upTo.length - 1], confirmed: false };
    expect(pullbackSignals(upTo).some((s) => s.index === last.index)).toBe(false);
  });
});
