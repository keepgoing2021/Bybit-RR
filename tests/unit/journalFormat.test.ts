import { describe, expect, it } from 'vitest';
import { fmtElapsed } from '../../src/journal/format';

describe('fmtElapsed', () => {
  it('1시간 전에는 초까지 보여 준다', () => {
    expect(fmtElapsed(0)).toBe('0분 00초');
    expect(fmtElapsed(65_000)).toBe('1분 05초');
    expect(fmtElapsed(3_599_999)).toBe('59분 59초');
  });
  it('1시간부터는 시간·분, 이틀부터는 일·시간', () => {
    expect(fmtElapsed(3_600_000)).toBe('1시간 0분');
    expect(fmtElapsed(5_400_000)).toBe('1시간 30분');
    expect(fmtElapsed(50 * 3_600_000)).toBe('2일 2시간');
  });
  it('시계가 어긋나 음수여도 0으로', () => {
    expect(fmtElapsed(-5000)).toBe('0분 00초');
  });
});
