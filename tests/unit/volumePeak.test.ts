import { describe, expect, it } from 'vitest';
import type { Candle } from '../../src/core/types';
import { DAY_MS, fmtRatio, fmtUsdShort, volumePeaks } from '../../src/core/volumePeak';

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
