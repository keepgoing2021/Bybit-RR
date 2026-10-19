import { describe, expect, it } from 'vitest';
import { formatTurnover, normalizeQuery, rankSymbols, resolveSymbol, searchSymbols } from '../../src/core/symbolSearch';
import type { SymbolInfo } from '../../src/core/types';

const list: SymbolInfo[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', '1000PEPEUSDT', 'ETHFIUSDT', 'SOLAYERUSDT', 'DEMO-BTC']
  .map((symbol) => ({ symbol, tickSize: 0.01 }));
const names = (r: SymbolInfo[]) => r.map((s) => s.symbol);

describe('normalizeQuery', () => {
  it('accepts TradingView and slash styles', () => {
    expect(normalizeQuery(' sol/usdt ')).toBe('SOLUSDT');
    expect(normalizeQuery('BYBIT:SOLUSDT.P')).toBe('SOLUSDT');
    expect(normalizeQuery('solusdt.p')).toBe('SOLUSDT');
    expect(normalizeQuery('Sol-Usdt')).toBe('SOLUSDT');
  });
});

describe('resolveSymbol', () => {
  it('maps a bare coin name to its USDT perpetual', () => {
    expect(resolveSymbol('sol', list)).toBe('SOLUSDT');
    expect(resolveSymbol('eth', list)).toBe('ETHUSDT'); // ETHFIUSDT보다 정확히 맞는 것이 우선
    expect(resolveSymbol('1000pepe', list)).toBe('1000PEPEUSDT');
  });

  it('keeps exact names and falls back to the best partial match', () => {
    expect(resolveSymbol('ETHFIUSDT', list)).toBe('ETHFIUSDT');
    expect(resolveSymbol('pepe', list)).toBe('1000PEPEUSDT');
    expect(resolveSymbol('demo-btc', list)).toBe('DEMO-BTC');
  });

  it('returns null when nothing matches', () => {
    expect(resolveSymbol('zzz', list)).toBeNull();
    expect(resolveSymbol('', list)).toBeNull();
  });
});

describe('searchSymbols', () => {
  it('returns everything in list order for an empty query', () => {
    expect(names(searchSymbols('', list))).toEqual(names(list));
  });

  it('ranks exact coin, then prefix, then contains', () => {
    expect(names(searchSymbols('sol', list))).toEqual(['SOLUSDT', 'SOLAYERUSDT']);
    expect(names(searchSymbols('eth', list))).toEqual(['ETHUSDT', 'ETHFIUSDT']);
    expect(names(searchSymbols('btc', list))).toEqual(['BTCUSDT', 'DEMO-BTC']);
  });
});

describe('rankSymbols (dropdown order like Bybit: volume, gainers, losers)', () => {
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'QUSDT', 'NOSTATUSDT', 'SOLAYERUSDT'].map((symbol) => ({ symbol, tickSize: 0.1 }));
  const stats = new Map(
    [
      { symbol: 'BTCUSDT', lastPrice: 1, changePct: 0.99, turnover24h: 8.27e9 },
      { symbol: 'ETHUSDT', lastPrice: 1, changePct: 0.49, turnover24h: 6.57e9 },
      { symbol: 'SOLUSDT', lastPrice: 1, changePct: 0.94, turnover24h: 1.25e9 },
      { symbol: 'QUSDT', lastPrice: 1, changePct: -13.91, turnover24h: 1.06e9 },
      { symbol: 'SOLAYERUSDT', lastPrice: 1, changePct: 8.42, turnover24h: 0.76e9 },
    ].map((t) => [t.symbol, t]),
  );
  const names = (q: string, sort: 'volume' | 'gainers' | 'losers') => rankSymbols(q, syms, stats, sort).map((s) => s.symbol);

  it('empty search: every symbol, sorted; symbols without stats go last', () => {
    expect(names('', 'volume')).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'QUSDT', 'SOLAYERUSDT', 'NOSTATUSDT']);
    expect(names('', 'gainers')).toEqual(['SOLAYERUSDT', 'BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'QUSDT', 'NOSTATUSDT']);
    expect(names('', 'losers')).toEqual(['QUSDT', 'ETHUSDT', 'SOLUSDT', 'BTCUSDT', 'SOLAYERUSDT', 'NOSTATUSDT']);
  });

  it('a search keeps only matches, the exact coin first, the rest in the chosen order', () => {
    expect(names('sol', 'gainers')).toEqual(['SOLUSDT', 'SOLAYERUSDT']);
    expect(names('o', 'volume')).toEqual(['SOLUSDT', 'SOLAYERUSDT', 'NOSTATUSDT']);
  });

  it('without any stats it falls back to name order', () => {
    expect(rankSymbols('', syms, new Map(), 'volume').map((s) => s.symbol)).toEqual(
      ['BTCUSDT', 'ETHUSDT', 'NOSTATUSDT', 'QUSDT', 'SOLAYERUSDT', 'SOLUSDT'],
    );
  });

  it('formats turnover short like Bybit', () => {
    expect([8.27e9, 759.91e6, 12_300, 950].map(formatTurnover)).toEqual(['8.27B', '759.91M', '12.30K', '950']);
  });
});
