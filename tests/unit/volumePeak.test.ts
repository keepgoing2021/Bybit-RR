import { describe, expect, it } from 'vitest';
import type { Candle } from '../../src/core/types';
import { DAY_MS, fmtRatio, fmtUsdShort, peakPeriodFor, volumePeaks, wavePeaks } from '../../src/core/volumePeak';

const H = 3_600_000;
const D0 = Date.UTC(2026, 10, 10); // UTC 자정 = 한국 시간 오전 9시
const c = (time: number, turnover: number | undefined, over: Partial<Candle> = {}): Candle => ({
  time, open: 100, high: 102, low: 98, close: 100, volume: 10, confirmed: true, ...(turnover === undefined ? {} : { turnover }), ...over,
});

describe('volumePeaks: 하루(UTC 자정 = 한국 오전 9시)마다 거래대금이 가장 큰 캔들', () => {
  it('날마다 하나, 그 캔들의 고가·저가·금액', () => {
    const list = [c(D0, 5e6), c(D0 + H, 9e6, { high: 110, low: 90 }), c(D0 + 2 * H, 7e6), c(D0 + DAY_MS, 1e6), c(D0 + DAY_MS + H, 3e6)];
    expect(volumePeaks(list, H)).toEqual([
      { time: D0 + H, high: 110, low: 90, usd: 9e6, approx: false, ratio: null, bandEnd: D0 + 2 * DAY_MS },
      { time: D0 + DAY_MS + H, high: 102, low: 98, usd: 3e6, approx: false, ratio: null, bandEnd: D0 + 3 * DAY_MS },
    ]);
  });
  it('같은 금액이면 먼저 나온 캔들', () => {
    expect(volumePeaks([c(D0, 5e6), c(D0 + H, 5e6)], H).map((p) => p.time)).toEqual([D0]);
  });
  it('하루 경계: 23시 캔들은 그날, 다음 0시 캔들은 다음 날', () => {
    const list = [c(D0 + 23 * H, 2e6), c(D0 + 24 * H, 1e6)];
    expect(volumePeaks(list, H).map((p) => p.time)).toEqual([D0 + 23 * H, D0 + 24 * H]);
  });
  it('거래대금이 없는 캔들은 거래량 × 평균가로 어림 (approx)', () => {
    const p = volumePeaks([c(D0, undefined, { volume: 10, open: 100, high: 104, low: 96, close: 100 })], H);
    expect(p).toEqual([{ time: D0, high: 104, low: 96, usd: 1000, approx: true, ratio: null, bandEnd: D0 + 2 * DAY_MS }]);
  });
  it('일봉 이상, 빈 목록, 거래 0은 표시 없음', () => {
    expect(volumePeaks([c(D0, 5e6)], DAY_MS)).toEqual([]);
    expect(volumePeaks([], H)).toEqual([]);
    expect(volumePeaks([c(D0, 0, { volume: 0 })], H)).toEqual([]);
  });
  it('이상한 값(NaN·음수)은 건너뛴다', () => {
    expect(volumePeaks([c(D0, Number.NaN, { volume: Number.NaN }), c(D0 + H, -5, { volume: -1 }), c(D0 + 2 * H, 4e6)], H).map((p) => p.time)).toEqual([D0 + 2 * H]);
  });
});

describe('평소 대비 배수 (바로 앞 20봉 평균)', () => {
  it('앞 봉이 5개 이상이면 배수, 자기 자신은 평균에 넣지 않는다', () => {
    const list = [...Array.from({ length: 5 }, (_, i) => c(D0 + i * H, 1e6)), c(D0 + 5 * H, 4e6)];
    expect(volumePeaks(list, H)[0]).toMatchObject({ time: D0 + 5 * H, ratio: 4 });
  });
  it('앞 봉이 20개보다 많으면 가까운 20개만', () => {
    const list = [...Array.from({ length: 10 }, (_, i) => c(D0 + i * 60_000, 100)), ...Array.from({ length: 20 }, (_, i) => c(D0 + (10 + i) * 60_000, 2)), c(D0 + 30 * 60_000, 1000)];
    expect(volumePeaks(list, 60_000)[0]).toMatchObject({ time: D0 + 30 * 60_000, ratio: 500 });
  });
  it('전날 봉도 평균에 들어간다 (하루 첫 봉이 터져도 배수가 나온다)', () => {
    const list = [...Array.from({ length: 6 }, (_, i) => c(D0 + (18 + i) * H, 2e6)), c(D0 + DAY_MS, 6e6)];
    expect(volumePeaks(list, H)[1]).toMatchObject({ time: D0 + DAY_MS, ratio: 3 });
  });
  it('fmtRatio', () => {
    expect(fmtRatio(4.23)).toBe('4.2배');
    expect(fmtRatio(12.6)).toBe('13배');
    expect(fmtRatio(1)).toBe('1.0배');
  });
});

describe('fmtUsdShort', () => {
  it('K · M · B', () => {
    expect(fmtUsdShort(950)).toBe('$950');
    expect(fmtUsdShort(12_340)).toBe('$12.3K');
    expect(fmtUsdShort(35_240_000)).toBe('$35.2M');
    expect(fmtUsdShort(1_240_000_000)).toBe('$1.24B');
    expect(fmtUsdShort(999_960)).toBe('$1.0M');
  });
});

describe('한 주 기준 (차트를 넓게 볼 때): 월요일 UTC 자정 ~ 다음 월요일', () => {
  const MON = Date.UTC(2026, 10, 9); // 월요일
  it('한 주에 하나 — 그 주에서 거래대금이 가장 큰 캔들', () => {
    const list = [c(MON, 5), c(MON + DAY_MS, 9), c(MON + 6 * DAY_MS + 23 * H, 7), c(MON + 7 * DAY_MS, 3), c(MON + 8 * DAY_MS, 4)];
    const out = volumePeaks(list, H, 'week');
    expect(out.map((p) => [p.time, p.usd])).toEqual([[MON + DAY_MS, 9], [MON + 8 * DAY_MS, 4]]);
    // 가격 구간 선은 다음 주 끝까지
    expect(out[0].bandEnd).toBe(MON + 14 * DAY_MS);
  });
  it('일요일 23시는 그 주, 월요일 0시는 다음 주', () => {
    const out = volumePeaks([c(MON - H, 5), c(MON, 4)], H, 'week');
    expect(out.map((p) => p.time)).toEqual([MON - H, MON]);
  });
  it('기준을 안 주면 하루', () => {
    expect(volumePeaks([c(MON, 5), c(MON + DAY_MS, 9)], H)).toHaveLength(2);
  });
});

describe('peakPeriodFor: 하루 폭이 이름표보다 좁으면 한 주로', () => {
  it('15분봉 8px → 하루 768px → 하루', () => {
    expect(peakPeriodFor(8, 15 * 60_000)).toBe('day');
  });
  it('1시간봉 3px → 하루 72px → 한 주', () => {
    expect(peakPeriodFor(3, H)).toBe('week');
  });
  it('4시간봉 8px → 하루 48px → 한 주', () => {
    expect(peakPeriodFor(8, 4 * H)).toBe('week');
  });
  it('값이 이상하면 하루', () => {
    expect(peakPeriodFor(Number.NaN, H)).toBe('day');
    expect(peakPeriodFor(8, 0)).toBe('day');
  });
});

describe('wavePeaks: 스윙 사이 한 파동마다 거래대금이 가장 큰 캔들', () => {
  const list = [3, 9, 4, 2, 8, 5, 1, 6, 7, 2].map((u, i) => c(D0 + i * H, u));
  it('파동마다 하나, 끝 지점 캔들은 그 파동에, 마지막 스윙 뒤도 한 파동', () => {
    // 스윙: 0번, 3번, 6번 → 파동 (0,3] (3,6] (6,끝]
    expect(wavePeaks(list, [0, 3, 6]).map((p) => p.usd)).toEqual([9, 8, 7]);
  });
  it('가격 구간 선은 다음 파동 끝까지, 마지막 둘은 오른쪽 끝까지', () => {
    const out = wavePeaks(list, [0, 3, 6]);
    expect(out[0].bandEnd).toBe(D0 + 6 * H);
    expect(out[2].bandEnd).toBeGreaterThan(D0 + 100 * DAY_MS);
  });
  it('스윙이 없으면 빈 목록, 순서가 섞여도 같다', () => {
    expect(wavePeaks(list, [])).toEqual([]);
    expect(wavePeaks(list, [6, 0, 3, 3]).map((p) => p.usd)).toEqual([9, 8, 7]);
  });
});
