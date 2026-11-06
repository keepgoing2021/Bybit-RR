import { describe, expect, it } from 'vitest';
import { mapTvToBybit, mergeGroups, parseMyGroups, parseTvSymbols, parseTvText, tvTicker, tvWatchlistId } from '../../src/core/tvImport';
import type { SymbolInfo } from '../../src/core/types';

const syms: SymbolInfo[] = [
  { symbol: 'BTCUSDT', tickSize: 0.1 },
  { symbol: 'TUSDT', tickSize: 0.0001 }, // 코인 Threshold — AT&T(NYSE:T)와 이름만 같다
  { symbol: 'KOUSDT', tickSize: 0.01, kind: 'stock' },
  { symbol: 'SOXLUSDT', tickSize: 0.01, kind: 'etf' },
  { symbol: 'AMDUSDT', tickSize: 0.0001 },
  { symbol: 'AMDSTOCKUSDT', tickSize: 0.01, kind: 'stock' },
  { symbol: 'XAUUSDT', tickSize: 0.01, kind: 'commodity' },
  { symbol: 'USDJPYUSDT', tickSize: 0.001, kind: 'forex' },
];

describe('트레이딩뷰 목록 가져오기', () => {
  it('### 묶음 나누기, 첫 묶음 앞은 「목록」, 중복·이상한 값은 버림', () => {
    expect(parseTvSymbols(['NYSE:KO', '###ETF', 'AMEX:SOXL', 'AMEX:SOXL', '<script>', 1, '###빈 묶음', '###숏', 'AMEX:SOXS'])).toEqual([
      { name: '목록', items: ['NYSE:KO'] },
      { name: 'ETF', items: ['AMEX:SOXL'] },
      { name: '숏', items: ['AMEX:SOXS'] },
    ]);
    expect(parseTvSymbols({})).toEqual([]);
  });

  it('붙여 넣은 글 (내보내기 txt 또는 JSON)', () => {
    expect(parseTvText('###먹을텐데,NYSE:KO,NASDAQ:SBUX\n###ETF,AMEX:SOXL')).toHaveLength(2);
    expect(parseTvText('["###A","NYSE:KO"]')).toEqual([{ name: 'A', items: ['NYSE:KO'] }]);
  });

  it('공유 링크 번호', () => {
    expect(tvWatchlistId('https://kr.tradingview.com/watchlists/16358394/')).toBe('16358394');
    expect(tvWatchlistId('https://evil.com/watchlists/1')).toBeNull();
  });

  it('Bybit로 잇기: 주식은 stock/ETF 종류만 (이름이 같은 코인과 헷갈리지 않게)', () => {
    expect(mapTvToBybit('NYSE:KO', syms)).toBe('KOUSDT');
    expect(mapTvToBybit('AMEX:SOXL', syms)).toBe('SOXLUSDT');
    expect(mapTvToBybit('NYSE:T', syms)).toBeNull(); // AT&T ≠ 코인 T
    expect(mapTvToBybit('NASDAQ:AMD', syms)).toBe('AMDSTOCKUSDT');
    expect(mapTvToBybit('TVC:GOLD', syms)).toBe('XAUUSDT');
    expect(mapTvToBybit('FX:USDJPY', syms)).toBe('USDJPYUSDT');
    expect(mapTvToBybit('BYBIT:BTCUSDT.P', syms)).toBe('BTCUSDT');
    expect(mapTvToBybit('HKEX:700', syms)).toBeNull();
    expect(tvTicker('NASDAQ:TSLA')).toBe('TSLA');
  });

  it('저장값 읽기·합치기', () => {
    expect(parseMyGroups('{bad')).toEqual([]);
    expect(parseMyGroups(JSON.stringify([{ name: 'A', items: ['NYSE:KO', '<x>'] }, { bad: 1 }]))).toEqual([{ name: 'A', items: ['NYSE:KO'] }]);
    expect(mergeGroups([{ name: 'A', items: ['X'] }, { name: 'B', items: ['Y'] }], [{ name: 'A', items: ['Z'] }]).map((g) => `${g.name}:${g.items}`)).toEqual(['B:Y', 'A:Z']);
  });
});
