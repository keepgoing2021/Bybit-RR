import { describe, expect, it } from 'vitest';
import { marketStructure } from '../../src/core/structure';
import type { Candle } from '../../src/core/types';

// 종가 경로로 캔들을 만든다 — 몸통만 있는 캔들(꼬리 없음)이라 고가·저가·종가 관계가 단순하다
const MIN = 60_000;
function path(closes: number[], wicks: Record<number, { high?: number; low?: number }> = {}): Candle[] {
  return closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1];
    return { time: i * MIN, open, close: c, high: Math.max(open, c, wicks[i]?.high ?? -Infinity), low: Math.min(open, c, wicks[i]?.low ?? Infinity), volume: 1, confirmed: true };
  });
}

describe('marketStructure — 다우 이론 HH·HL·LH·LL과 BOS·CHoCH', () => {
  // 상승: 고점 14 → 16 → 18, 저점 11 → 13 … 그다음 마지막 저점(13)을 종가로 깨며 하락 전환
  const up = path([10, 12, 14, 12, 11, 13, 16, 14, 13, 15, 18, 16, 15, 12, 10]);

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
    const down = path([20, 18, 16, 18, 19, 17, 14, 16, 17, 15, 12, 14, 15, 18, 20]);
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
});
