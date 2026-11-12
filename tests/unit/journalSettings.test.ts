import { describe, expect, it } from 'vitest';
import { emptyJournal, type Trade } from '../../src/core/journal';
import { addItem, autoRiskExample, dailyStatus, ITEM_MAX_CHARS, LIMIT_PRESETS, limitUsage, presetOf, removeItem, renameItem, stepValue } from '../../src/core/journalSettings';

const NOW = Date.UTC(2026, 10, 12, 6); // 한국 시간 11/12 15:00
const trade = (id: string, openedAt: number, exit: number | null, closedAt: number | null): Trade => ({
  id, symbol: 'BTCUSDT', side: 'LONG', entry: 100, sl: 98, tp: 104, qty: null, riskUsdt: 10, riskPct: 1, openedAt, closedAt, exit,
  setup: '', quality: 'rule', reason: '', rules: [], feeRate: 0,
});

describe('목록 편집 (셋업·진입 규칙 칩)', () => {
  it('추가: 앞뒤 공백을 떼고, 빈 글·중복·최대 개수는 거절', () => {
    expect(addItem(['a'], '  b  ', 8)).toEqual({ ok: true, list: ['a', 'b'] });
    expect(addItem(['a'], '   ', 8)).toEqual({ ok: false, reason: '내용을 적어 주세요.' });
    expect(addItem(['a'], 'a', 8)).toEqual({ ok: false, reason: '이미 있는 항목이에요.' });
    expect(addItem(['a', 'b'], 'c', 2)).toEqual({ ok: false, reason: '최대 2개까지예요. 하나를 지우고 추가해 주세요.' });
  });
  it('추가: 너무 긴 글은 60자로 자른다', () => {
    const r = addItem([], 'x'.repeat(100), 8);
    expect(r.ok && r.list[0].length).toBe(ITEM_MAX_CHARS);
  });
  it('이름 바꾸기: 자리 그대로, 같은 이름이 이미 있으면 거절, 안 바꿨으면 그대로', () => {
    expect(renameItem(['a', 'b', 'c'], 1, ' z ')).toEqual({ ok: true, list: ['a', 'z', 'c'] });
    expect(renameItem(['a', 'b'], 1, 'a')).toEqual({ ok: false, reason: '이미 있는 항목이에요.' });
    expect(renameItem(['a', 'b'], 1, 'b')).toEqual({ ok: true, list: ['a', 'b'] });
    expect(renameItem(['a', 'b'], 1, '')).toEqual({ ok: false, reason: '내용을 적어 주세요.' });
  });
  it('지우기', () => {
    expect(removeItem(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    expect(removeItem(['a'], 5)).toEqual(['a']);
  });
});

describe('숫자 − / + (stepValue)', () => {
  it('걸음만큼 움직이고 범위를 넘지 않는다, 소수 오차 없이', () => {
    expect(stepValue(3, 1, { step: 1, min: 1, max: 20 })).toBe(4);
    expect(stepValue(1, -1, { step: 1, min: 1, max: 20 })).toBe(1);
    expect(stepValue(0.3, 1, { step: 0.1, min: 0.1, max: 5 })).toBe(0.4);
    expect(stepValue(20, 1, { step: 1, min: 1, max: 20 })).toBe(20);
  });
  it('직접 친 값(dir 0)은 걸음에 맞춰 반올림하고 범위 안으로, 이상한 값은 원래 값', () => {
    expect(stepValue(2.26, 0, { step: 0.5, min: 0, max: 50 })).toBe(2.5);
    expect(stepValue(999, 0, { step: 1, min: 1, max: 20 })).toBe(20);
    expect(stepValue(Number.NaN, 0, { step: 1, min: 1, max: 20 }, 5)).toBe(5);
  });
});

describe('손실 한도 한 번에 고르기', () => {
  it('세 가지 묶음, 지금 값이 어느 묶음인지', () => {
    expect(LIMIT_PRESETS.map((p) => p.key)).toEqual(['safe', 'normal', 'bold']);
    expect(presetOf({ daily: 3, weekly: 6, monthly: 10 })).toBe('normal');
    expect(presetOf({ daily: 3, weekly: 6, monthly: 11 })).toBeNull();
  });
  it('한도 사용량: 잃은 만큼만 (번 날은 0), 한도 0은 끔', () => {
    expect(limitUsage(-1.5, 6)).toEqual({ used: 1.5, ratio: 0.25, off: false });
    expect(limitUsage(2, 6)).toEqual({ used: 0, ratio: 0, off: false });
    expect(limitUsage(-9, 6).ratio).toBe(1);
    expect(limitUsage(-1, 0)).toEqual({ used: 1, ratio: 0, off: true });
  });
});

describe('오늘 상태 (하루 운영 규칙 옆에 보여 줄 것)', () => {
  it('오늘 연 거래 수와 지금 연속 손절 수', () => {
    const j = emptyJournal();
    const H = 3_600_000;
    j.trades = [
      trade('old', NOW - 30 * H, 98, NOW - 29 * H), // 어제
      trade('a', NOW - 5 * H, 104, NOW - 4 * H), // 오늘 익절
      trade('b', NOW - 3 * H, 98, NOW - 2 * H), // 오늘 손절
      trade('c', NOW - 1 * H, null, null), // 진행 중
    ];
    expect(dailyStatus(j, NOW)).toEqual({ openedToday: 3, lossStreak: 1 });
  });
  it('기록이 없으면 0', () => {
    expect(dailyStatus(emptyJournal(), NOW)).toEqual({ openedToday: 0, lossStreak: 0 });
  });
});

describe('위험 자동 조절 예시', () => {
  it('총 자산 기준 금액', () => {
    expect(autoRiskExample({ enabled: true, basePct: 0.5, upPct: 1, thresholdPct: 2 }, 10_000)).toEqual({ capital: 10_000, base: 50, up: 100, threshold: 200 });
  });
});
