import { describe, expect, it } from 'vitest';
import { isDisplacement, marketStructure } from '../../src/core/structure';
import type { Candle } from '../../src/core/types';

// 종가 경로로 캔들을 만든다 — 몸통만 있는 캔들(꼬리 없음)이라 고가·저가·종가 관계가 단순하다.
// 거래량은 몸통 크기만큼(최소 1) — 큰 봉에 거래량이 붙는 보통 경우
const MIN = 60_000;
function path(closes: number[], wicks: Record<number, { high?: number; low?: number }> = {}): Candle[] {
  return closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1];
    return { time: i * MIN, open, close: c, high: Math.max(open, c, wicks[i]?.high ?? -Infinity), low: Math.min(open, c, wicks[i]?.low ?? Infinity), volume: Math.max(1, Math.abs(c - open)), confirmed: true };
  });
}

describe('marketStructure — 다우 이론 HH·HL·LH·LL과 BOS·CHoCH', () => {
  // 상승: 고점 14 → 16 → 18, 저점 11 → 13 … 그다음 마지막 저점(13)을 큰 음봉(15→10, 평균 몸통의 2.5배 이상)으로 깨며 하락 전환
  const up = path([10, 12, 14, 12, 11, 13, 16, 14, 13, 15, 18, 16, 15, 10, 9]);

  it('고점은 HH/LH, 저점은 HL/LL로 이름 붙인다(첫 고점·저점은 비교할 게 없어 이름 없음)', () => {
    const { points } = marketStructure(up, 1);
    expect(points.map((p) => `${p.kind[0]}${p.price}:${p.label ?? '-'}`)).toEqual([
      'h14:-', 'l11:-', 'h16:HH', 'l13:HL', 'h18:HH',
    ]);
  });

  it('직전 고점을 종가로 넘으면 BOS(추세 계속), 상승 중 마지막 저점(HL)이 깨지면 CHoCH(전환)', () => {
    const { breaks, trend } = marketStructure(up, 1);
    expect(breaks.map((b) => `${b.type}-${b.dir}@${b.price}`)).toEqual(['BOS-up@14', 'BOS-up@16', 'CHoCH-down@13']);
    expect(trend).toBe('down');
  });

  it('꼬리로만 찌르고 종가가 안쪽이면 돌파가 아니다(가짜 돌파 거르기)', () => {
    // 고점 14 확정 뒤, 5번 캔들이 꼬리로 15까지 갔지만 종가 13
    const c = path([10, 12, 14, 12, 11, 13, 12], { 5: { high: 15 } });
    expect(marketStructure(c, 1).breaks).toEqual([]);
  });

  it('스윙이 확정되기 전(오른쪽 봉이 아직 없을 때)엔 그 레벨 돌파를 세지 않는다 — 지나서 바뀌는 표시 없음', () => {
    // 마지막 캔들이 고점 14를 넘었지만, 14는 2봉 기준으로 아직 확정 전(오른쪽 2봉 필요)
    const c = path([10, 12, 14, 13, 15]);
    expect(marketStructure(c, 2).breaks).toEqual([]);
  });

  it('하락 추세(LH·LL) 중 마지막 고점을 종가로 넘으면 CHoCH 상승', () => {
    const down = path([20, 18, 16, 18, 19, 17, 14, 16, 17, 15, 12, 14, 15, 20, 21]);
    const { breaks, points } = marketStructure(down, 1);
    expect(points.filter((p) => p.kind === 'high').map((p) => p.label)).toEqual([null, 'LH']);
    expect(breaks.at(-1)).toMatchObject({ type: 'CHoCH', dir: 'up', price: 17 });
  });

  it('돌파 정보에는 깨진 스윙 위치와 깬 캔들 위치가 같이 있다(차트에 선을 긋는 데 쓴다)', () => {
    const b = marketStructure(up, 1).breaks.at(-1)!;
    expect(up[b.fromIndex].low).toBe(13);
    expect(up[b.index].close).toBeLessThan(13);
    expect(b.index).toBeGreaterThan(b.fromIndex);
  });

  it('추세전환은 강하게 깬 것만 — 몸통이 평소보다 작게 깨면 표시도 없고 추세도 그대로 (MSS)', () => {
    // 상승 추세(BOS 위로 두 번) 뒤, 마지막 저점 13을 몸통 0.6짜리 작은 봉으로 깸 (평균 몸통 ~2).
    // 다음 봉이 13.6까지 올라와 빈 구간(FVG)도 없다
    // 실제 캔들처럼 꼬리를 붙인다(꼬리 없는 계단식 봉은 봉마다 빈 구간이 생겨 전부 '강함'이 된다)
    const c = path([10, 12, 14, 12, 11, 13, 16, 14, 13, 15, 18, 16, 15, 14, 13.5, 12.9, 13.6]).map((k, i) =>
      i >= 11 ? { ...k, high: Math.max(k.open, k.close) + 1, low: Math.min(k.open, k.close) - (i === 15 ? 0 : 1) } : k,
    );
    const { breaks, trend } = marketStructure(c, 1);
    expect(breaks.some((b) => b.type === 'CHoCH')).toBe(false);
    expect(trend).toBe('up');
  });

  it('깨는 움직임 안에 큰 봉이 있으면(급하게 떨어진 뒤 작은 봉으로 깸) 강하게 깬 것으로 본다', () => {
    // 꼬리 붙인 약한 경우와 같지만, 깨기 직전 봉(14번)을 큰 음봉으로
    const c = path([10, 12, 14, 12, 11, 13, 16, 14, 13, 15, 18, 16, 15, 14, 13.05, 12.9, 13.6]).map((k, i) =>
      i >= 11 ? { ...k, high: Math.max(k.open, k.close) + 1, low: Math.min(k.open, k.close) - (i === 15 ? 0 : 1) } : k,
    );
    c[14] = { ...c[14], open: 18, close: 13.05, high: 18.2, low: 13, volume: 5 };
    const { breaks, trend } = marketStructure(c, 1);
    expect(breaks.at(-1)).toMatchObject({ type: 'CHoCH', dir: 'down', index: 15 });
    expect(trend).toBe('down');
  });

  it('isDisplacement: 깬 방향 몸통이 평균의 2.5배 이상이면 강함, 반대 방향 봉은 아님', () => {
    expect(isDisplacement(path([10, 11, 12, 13, 14, 15, 16, 18.6]), 7, 'up')).toBe(true);
    expect(isDisplacement(path([10, 11, 12, 13, 14, 15, 16, 18]), 7, 'up')).toBe(false);
    expect(isDisplacement(path([10, 11, 12, 13, 14, 15, 16, 18.6]), 7, 'down')).toBe(false);
  });

  it('몸통이 커도 거래량이 평소 수준이면 강하지 않다(거래량이 추세를 확인해야 한다)', () => {
    const c = path([10, 11, 12, 13, 14, 15, 16, 18.6]);
    expect(isDisplacement(c, 7, 'up')).toBe(true);
    c[7] = { ...c[7], volume: 1.2 }; // 평균 1의 1.2배
    expect(isDisplacement(c, 7, 'up')).toBe(false);
  });
});
