import { describe, expect, it } from 'vitest';
import { detectPullbacks, heikinAshi, pullbackSignals, type PullbackBar } from '../../src/core/pullback';
import type { Candle } from '../../src/core/types';

// 'U' = MA20 위 양봉, 'u' = MA20 위 음봉, 'D' = MA20 아래 음봉, 'd' = MA20 아래 양봉, '-' = MA 없음(초반)
function bars(code: string): PullbackBar[] {
  return [...code].map((ch, i) => ({
    time: i * 60_000,
    green: ch === 'U' || ch === 'd',
    side: ch === '-' ? null : ch === 'U' || ch === 'u' ? 'up' : 'down',
  }));
}
const at = (code: string, minWave = 3) => detectPullbacks(bars(code), minWave).map((s) => `${s.dir}@${s.index}`);

describe('detectPullbacks — MA20 정배열 전환 → 양봉 파동 → 음봉 파동 → 다시 양봉', () => {
  it('역배열에서 정배열로 바뀐 뒤 양봉 3 · 음봉 3 · 양봉 = 롱 신호 (그 양봉 자리)', () => {
    //          0123456789
    expect(at('DDUUUuuuU')).toEqual(['long@8']);
  });

  it('숏은 정반대: 역배열 전환 → 음봉 3 → 양봉 3 → 다시 음봉', () => {
    expect(at('UUDDDdddD')).toEqual(['short@8']);
  });

  it('파동이 3개 미만이면 신호 없음 (양봉 2개)', () => {
    expect(at('DDUUuuuU')).toEqual([]);
  });

  it('음봉 파동이 3개 미만이면 신호 없음, 그 양봉은 다시 첫 양봉 파동으로 센다', () => {
    // 양봉3 → 음봉2 → 양봉(파동 다시 셈: 1) → 음봉3 → 양봉: 양봉 파동이 1개뿐이라 신호 없음
    expect(at('DUUUuuUuuuU')).toEqual([]);
    // 양봉3 → 음봉2 → 양봉3 → 음봉3 → 양봉 = 신호
    expect(at('DUUUuuUUUuuuU')).toEqual(['long@12']);
  });

  it('음봉 파동 중 MA20 아래로 내려가면 무효 (그 자리부터 숏 쪽으로 다시 본다)', () => {
    expect(at('DUUUuuDdU')).toEqual([]);
  });

  it('신호는 정배열 전환 한 번에 한 번만', () => {
    expect(at('DUUUuuuUUUuuuU')).toEqual(['long@7']);
  });

  it('처음부터 정배열이면(전환을 못 봤으면) 신호 없음 — MA가 생기기 전 구간도 전환으로 치지 않는다', () => {
    expect(at('UUUuuuU')).toEqual([]);
    expect(at('--UUUuuuU')).toEqual([]);
  });

  it('파동 개수를 바꿀 수 있다 (2개)', () => {
    expect(at('DUUuuU', 2)).toEqual(['long@5']);
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
    expect(ha[1].open).toBe(11);
    expect(ha[1].close).toBe(13.5);
    expect(ha[1].high).toBe(16);
    expect(ha[1].low).toBe(11);
  });
});

describe('pullbackSignals — 실제 캔들로', () => {
  // 30봉 하락 → 6봉 급등(MA20 위로) → 5봉 눌림 → 반등
  function path(closes: number[]): Candle[] {
    return closes.map((c, i) => {
      const o = i === 0 ? c : closes[i - 1];
      return { time: i * 60_000, open: o, close: c, high: Math.max(o, c), low: Math.min(o, c), volume: 1, confirmed: true };
    });
  }
  const closes = [
    ...Array.from({ length: 30 }, (_, i) => 130 - i), // 130 → 101
    104, 108, 112, 116, 120, 124, // 급등
    121, 118, 116, 115, 114, // 눌림 (MA20 위 유지)
    118, 122,
  ];

  it('눌림 뒤 첫 하이킨아시 양봉에 롱 신호 하나', () => {
    const s = pullbackSignals(path(closes), 20, 3);
    expect(s.map((x) => x.dir)).toEqual(['long']);
    expect(s[0].index).toBeGreaterThanOrEqual(41);
    expect(s[0].price).toBe(Math.min(...path(closes).slice(s[0].index, s[0].index + 1).map((c) => c.low)));
  });

  it('신호 계산에는 마감된 봉만 쓴다 (진행 중인 봉 제외)', () => {
    const full = pullbackSignals(path(closes), 20, 3);
    const upTo = path(closes).slice(0, full[0].index + 1);
    expect(pullbackSignals(upTo, 20, 3)).toHaveLength(1);
    upTo[upTo.length - 1] = { ...upTo[upTo.length - 1], confirmed: false };
    expect(pullbackSignals(upTo, 20, 3)).toEqual([]);
  });
});
