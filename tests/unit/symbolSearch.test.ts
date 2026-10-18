import { describe, expect, it } from 'vitest';
import { normalizeQuery, resolveSymbol, searchSymbols } from '../../src/core/symbolSearch';
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
