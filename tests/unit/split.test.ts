import { describe, expect, it } from 'vitest';
import { defaultPaneTfs, fillPanes, parseSplit } from '../../src/core/split';

describe('화면 분할', () => {
  it('보기 칸 기본 시간봉: 계산기 칸보다 큰 것부터', () => {
    expect(defaultPaneTfs('15', 3)).toEqual(['60', '240', 'D']);
    expect(defaultPaneTfs('60', 1)).toEqual(['240']);
    expect(defaultPaneTfs('D', 3)).toEqual(['W', '240', '60']); // 위가 모자라면 큰 쪽에서
  });

  it('칸 수만큼 채우고, 이미 고른 칸은 그대로', () => {
    expect(fillPanes({ n: 2, panes: [] }, 'BTCUSDT', '15')).toEqual([{ symbol: 'BTCUSDT', tf: '60' }]);
    expect(fillPanes({ n: 4, panes: [{ symbol: 'ETHUSDT', tf: '60' }] }, 'BTCUSDT', '15')).toEqual([
      { symbol: 'ETHUSDT', tf: '60' },
      { symbol: 'BTCUSDT', tf: '240' },
      { symbol: 'BTCUSDT', tf: 'D' },
    ]);
    // 2칸으로 줄여도 고른 칸은 남겨 둔다
    expect(fillPanes({ n: 2, panes: [{ symbol: 'A1', tf: '5' }, { symbol: 'B2', tf: '60' }] }, 'BTCUSDT', '15')).toHaveLength(2);
  });

  it('저장값 읽기: 이상한 값은 버린다', () => {
    expect(parseSplit(null)).toEqual({ n: 1, panes: [] });
    expect(parseSplit('{bad')).toEqual({ n: 1, panes: [] });
    expect(parseSplit('{"n":3,"panes":[]}')).toEqual({ n: 1, panes: [] });
    expect(parseSplit('{"n":4,"panes":[{"symbol":"ETHUSDT","tf":"60"},{"symbol":"<x>","tf":"60"},{"symbol":"SOLUSDT","tf":"7"}]}')).toEqual({
      n: 4,
      panes: [{ symbol: 'ETHUSDT', tf: '60' }],
    });
  });
});
