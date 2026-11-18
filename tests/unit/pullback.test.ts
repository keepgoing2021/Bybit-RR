import { describe, expect, it } from 'vitest';
import { detectPullbacks, heikinAshi, pullbackSignals, type PullbackBar } from '../../src/core/pullback';
import type { Candle } from '../../src/core/types';

// 'U' = 정배열 양봉, 'u' = 정배열 음봉, 'D' = 역배열 음봉, 'd' = 역배열 양봉, '-' = MA 없음(초반)
function bars(code: string): PullbackBar[] {
  return [...code].map((ch, i) => ({
    time: i * 60_000,
    green: ch === 'U' || ch === 'd',
    side: ch === '-' ? null : ch === 'U' || ch === 'u' ? 'up' : 'down',
  }));
}
const at = (code: string, minWave = 3) => detectPullbacks(bars(code), minWave).map((s) => `${s.dir}@${s.index}`);

describe('detectPullbacks — 정배열 전환 → 양봉 파동 → 음봉 파동 → 다시 양봉', () => {
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

  it('음봉 파동 중 역배열로 돌아가면 무효 (그 자리부터 숏 쪽으로 다시 본다)', () => {
    expect(at('DUUUuuDdU')).toEqual([]);
  });

  it('테두리 상자는 눌림 파동 첫 봉부터 신호 봉까지', () => {
    const [s] = detectPullbacks(bars('DDUUUuuuU'), 3);
    expect([s.fromIndex, s.index]).toEqual([5, 8]);
    const [r] = detectPullbacks(bars('DUUUuuUUUuuuU'), 3);
    expect(r.fromIndex).toBe(9);
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

describe('detectPullbacks — 전환 후 기한', () => {
  it('전환 후 maxBars봉 안에 완성될 때만 신호 (늦게 완성되면 버림)', () => {
    // 전환 1번 봉 → 신호 7번 봉: 6봉 뒤
    expect(detectPullbacks(bars('DUUUuuuU'), 3, 6).map((x) => x.index)).toEqual([7]);
    expect(detectPullbacks(bars('DUUUuuuU'), 3, 5)).toEqual([]);
  });
});

describe('pullbackSignals — MA20 × MA100 정배열 전환 (실제 캔들로)', () => {
  function path(closes: number[]): Candle[] {
    return closes.map((c, i) => {
      const o = i === 0 ? c : closes[i - 1];
      return { time: i * 60_000, open: o, close: c, high: Math.max(o, c), low: Math.min(o, c), volume: 1, confirmed: true };
    });
  }
  // 120봉 하락 → rally봉 급등(+3) → 5봉 눌림(−2) → 4봉 반등(+3). MA20이 MA100을 넘는 건 140번 봉
  function closes(rally: number): number[] {
    const a = Array.from({ length: 120 }, (_, i) => 200 - i * 0.8);
    let p = a[a.length - 1];
    for (let i = 0; i < rally; i++) a.push((p += 3));
    for (let i = 0; i < 5; i++) a.push((p -= 2));
    for (let i = 0; i < 4; i++) a.push((p += 3));
    return a;
  }

  it('골든크로스 직후 눌림 → 반등이면 매수 신호 하나, 상자는 눌림 첫 봉부터', () => {
    const c = path(closes(25));
    const s = pullbackSignals(c, 20, 100, 3, 15);
    expect(s.map((x) => `${x.dir}@${x.index}`)).toEqual(['long@151']);
    expect(s[0].index - 140).toBeLessThanOrEqual(15);
    const span = c.slice(s[0].fromIndex, s[0].index + 1);
    expect(s[0].high).toBe(Math.max(...span.map((x) => x.high)));
    expect(s[0].low).toBe(Math.min(...span.map((x) => x.low)));
    expect(s[0].price).toBe(c[s[0].index].low);
  });

  it('한참 오른 뒤(전환 후 15봉 넘어서) 눌림은 신호 없음 — 고점에서 매수 변곡? 금지 (사용자 지적)', () => {
    expect(pullbackSignals(path(closes(40)), 20, 100, 3, 15)).toEqual([]);
  });

  it('신호 계산에는 마감된 봉만 쓴다 (진행 중인 봉 제외)', () => {
    const upTo = path(closes(25)).slice(0, 152);
    expect(pullbackSignals(upTo, 20, 100, 3, 15)).toHaveLength(1);
    upTo[upTo.length - 1] = { ...upTo[upTo.length - 1], confirmed: false };
    expect(pullbackSignals(upTo, 20, 100, 3, 15)).toEqual([]);
  });
});
