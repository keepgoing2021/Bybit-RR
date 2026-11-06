import { describe, expect, it } from 'vitest';
import { buildGroups, chosung, matchKorean, nextSort, parseFavorites, parseSort, sortRows, tickDirection, toggleFavorite, type WatchRow } from '../../src/core/watchlist';
import type { SymbolInfo, TickerStat } from '../../src/core/types';

const sym = (symbol: string) => ({ symbol, tickSize: 0.01 }) as SymbolInfo;
const st = (symbol: string, lastPrice: number, changePct: number, turnover24h: number): TickerStat => ({ symbol, lastPrice, changePct, turnover24h });

describe('종목 리스트', () => {
  const rows: WatchRow[] = [
    { symbol: 'ETHUSDT', stat: st('ETHUSDT', 2400, -1.4, 3.9e9) },
    { symbol: 'NEWUSDT', stat: null },
    { symbol: 'BTCUSDT', stat: st('BTCUSDT', 79000, -1, 5.8e9) },
    { symbol: 'SOLUSDT', stat: st('SOLUSDT', 95, 2, 6.5e8) },
  ];

  it('거래대금 큰 순, 시세 없는 종목은 맨 뒤', () => {
    expect(sortRows(rows, { key: 'turnover', desc: true }).map((r) => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'NEWUSDT']);
    expect(sortRows(rows, { key: 'turnover', desc: false }).map((r) => r.symbol)).toEqual(['SOLUSDT', 'ETHUSDT', 'BTCUSDT', 'NEWUSDT']);
  });

  it('변동%·이름순 정렬', () => {
    expect(sortRows(rows, { key: 'change', desc: true }).map((r) => r.symbol)).toEqual(['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'NEWUSDT']);
    expect(sortRows(rows, { key: 'symbol', desc: false }).map((r) => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'NEWUSDT', 'SOLUSDT']);
  });

  it('같은 칸을 다시 누르면 방향만 바뀌고, 새 숫자 칸은 큰 값부터, 이름 칸은 가나다순부터', () => {
    expect(nextSort({ key: 'turnover', desc: true }, 'turnover')).toEqual({ key: 'turnover', desc: false });
    expect(nextSort({ key: 'turnover', desc: true }, 'change')).toEqual({ key: 'change', desc: true });
    expect(nextSort({ key: 'turnover', desc: true }, 'symbol')).toEqual({ key: 'symbol', desc: false });
  });

  it('즐겨찾기와 나머지로 나누고 검색어로 둘 다 거른다', () => {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'ETCUSDT', 'SOLUSDT'].map(sym);
    const stats = new Map(rows.filter((r) => r.stat).map((r) => [r.symbol, r.stat!]));
    const g = buildGroups(symbols, stats, ['ETHUSDT', 'GONEUSDT'], '', { key: 'turnover', desc: true });
    expect(g.favorites.map((r) => r.symbol)).toEqual(['ETHUSDT']); // 목록에 없는 즐겨찾기는 빠진다
    expect(g.rest.map((r) => r.symbol)).toEqual(['BTCUSDT', 'SOLUSDT', 'ETCUSDT']);
    const q = buildGroups(symbols, stats, ['ETHUSDT'], 'et', { key: 'turnover', desc: true });
    expect(q.favorites.map((r) => r.symbol)).toEqual(['ETHUSDT']);
    expect(q.rest.map((r) => r.symbol)).toEqual(['ETCUSDT']);
  });

  it('가격 깜빡임 방향', () => {
    expect(tickDirection(undefined, 1)).toBeNull();
    expect(tickDirection(1, 1)).toBeNull();
    expect(tickDirection(1, 2)).toBe('up');
    expect(tickDirection(2, 1)).toBe('down');
  });

  it('저장된 즐겨찾기·정렬 읽기: 깨졌으면 기본값, 이상한 값은 버림', () => {
    expect(parseFavorites(null)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(parseFavorites('{bad')).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(parseFavorites('["SOLUSDT","<script>",1,"SOLUSDT"]')).toEqual(['SOLUSDT']);
    expect(parseFavorites('[]')).toEqual([]);
    expect(toggleFavorite(['A1'], 'B2')).toEqual(['A1', 'B2']);
    expect(toggleFavorite(['A1', 'B2'], 'A1')).toEqual(['B2']);
    expect(parseSort('{"key":"change","desc":false}')).toEqual({ key: 'change', desc: false });
    expect(parseSort('{"key":"x","desc":1}')).toEqual({ key: 'turnover', desc: true });
  });

  it('한글·초성 검색과 김프 정렬', () => {
    expect(chosung('비트코인')).toBe('ㅂㅌㅋㅇ');
    expect(matchKorean('비트코인', 'ㅂㅌ')).toBe(true);
    expect(matchKorean('비트코인', '코인')).toBe(true);
    expect(matchKorean('이더리움', 'ㅂㅌ')).toBe(false);
    expect(matchKorean(undefined, 'ㅂ')).toBe(false);
    const symbols = ['BTCUSDT', 'ETHUSDT', 'ETCUSDT'].map(sym);
    const ko: Record<string, string> = { BTCUSDT: '비트코인', ETHUSDT: '이더리움', ETCUSDT: '이더리움클래식' };
    const prem: Record<string, number> = { BTCUSDT: 0.5, ETHUSDT: 1.2 };
    const g = buildGroups(symbols, new Map(), [], 'ㅇㄷ', { key: 'premium', desc: true }, (s) => ko[s], (s) => prem[s] ?? null);
    expect(g.rest.map((r) => r.symbol)).toEqual(['ETHUSDT', 'ETCUSDT']); // 김프 없는 ETC는 뒤
    // 김프 칸은 없앴다(2026-11-06): 예전에 김프로 정렬해 뒀으면 기본(거래대금)으로
    expect(parseSort('{"key":"premium","desc":true}')).toEqual({ key: 'turnover', desc: true });
  });
});
