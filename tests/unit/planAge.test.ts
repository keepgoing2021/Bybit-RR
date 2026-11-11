import { describe, expect, it } from 'vitest';
import { planAge, sameLocalDay } from '../../src/core/planAge';

const H = 3600_000;
const NOW = Date.UTC(2026, 10, 11, 3, 0);

describe('오래된 계산 알림', () => {
  it('1시간 안 된 계산은 조용히', () => {
    expect(planAge(NOW - 59 * 60_000, 100, 90, NOW, false)).toEqual({ text: null, warn: false });
    expect(planAge(NOW + 5000, 100, 90, NOW, false).text).toBeNull(); // 시계가 뒤로 간 경우
  });

  it('시장가 계산이 오래되면 경과 시간·지금 가격과의 차이·다시 계산 안내', () => {
    const a = planAge(NOW - 20 * H, 80246.3, 73737, NOW, false);
    expect(a.warn).toBe(true);
    expect(a.text).toBe('20시간 전 계산 · 지금 가격은 진입가보다 −8.1% — LONG/SHORT를 다시 눌러 새로 계산하세요');
    expect(planAge(NOW - 50 * H, 100, 103, NOW, false).text).toContain('2일 전 계산 · 지금 가격은 진입가보다 +3.0%');
    expect(planAge(NOW - 2 * H, 100, 100.01, NOW, false).text).toContain('진입가보다 0.0%');
  });

  it('지정가(직접 넣은 진입가)는 알려만 주고 강조하지 않는다', () => {
    const a = planAge(NOW - 5 * H, 100, 104, NOW, true);
    expect(a).toEqual({ text: '5시간 전 계산 · 지금 가격은 진입가보다 +4.0%', warn: false });
  });

  it('지금 가격을 아직 모르면 경과 시간만', () => {
    expect(planAge(NOW - 3 * H, 100, null, NOW, true).text).toBe('3시간 전 계산');
  });

  it('같은 날 판정은 현지 시각 기준', () => {
    const d = new Date(2026, 10, 11, 0, 30).getTime();
    expect(sameLocalDay(d, d + 23 * H)).toBe(true);
    expect(sameLocalDay(d, d - H)).toBe(false);
  });
});
