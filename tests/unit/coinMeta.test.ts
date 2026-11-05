import { describe, expect, it } from 'vitest';
import { bybitBase, kimchiPremium, parseCoinGecko, parseUpbitMarkets, parseUpbitPrices } from '../../src/core/coinMeta';

describe('종목 바깥 정보 (업비트·코인게코)', () => {
  it('Bybit 이름 → 코인 이름·묶음 수', () => {
    expect(bybitBase('BTCUSDT')).toEqual({ base: 'BTC', mult: 1 });
    expect(bybitBase('1000PEPEUSDT')).toEqual({ base: 'PEPE', mult: 1000 });
    expect(bybitBase('1000000MOGUSDT')).toEqual({ base: 'MOG', mult: 1000000 });
    expect(bybitBase('SHIB1000USDT')).toEqual({ base: 'SHIB', mult: 1000 });
    expect(bybitBase('1INCHUSDT')).toEqual({ base: '1INCH', mult: 1 }); // 1로 시작해도 10, 100… 아니면 그대로
    expect(bybitBase('A8USDT')).toEqual({ base: 'A8', mult: 1 });
  });

  it('김프: 업비트가 2% 비싸면 +2%, 묶음 수를 반영', () => {
    expect(kimchiPremium(102 * 1400, 100, 1, 1400)).toBeCloseTo(2, 6);
    // 1000PEPE 0.01달러 = PEPE 하나 0.00001달러
    expect(kimchiPremium(0.00001 * 1400 * 0.99, 0.01, 1000, 1400)).toBeCloseTo(-1, 6);
    expect(kimchiPremium(undefined, 100, 1, 1400)).toBeNull();
    expect(kimchiPremium(100, 100, 1, undefined)).toBeNull();
  });

  it('업비트 마켓: 원화만, 유의·주의', () => {
    const m = parseUpbitMarkets([
      { market: 'KRW-BTC', korean_name: '비트코인', market_event: { warning: false, caution: { PRICE_FLUCTUATIONS: false } } },
      { market: 'KRW-EGLD', korean_name: '멀티버스엑스', market_event: { warning: true, caution: { GLOBAL_PRICE_DIFFERENCES: true } } },
      { market: 'BTC-ETH', korean_name: '이더리움' },
      'junk',
    ]);
    expect([...m.keys()]).toEqual(['BTC', 'EGLD']);
    expect(m.get('BTC')).toEqual({ ko: '비트코인', warn: false, caution: false });
    expect(m.get('EGLD')).toEqual({ ko: '멀티버스엑스', warn: true, caution: true });
    expect(parseUpbitMarkets({ error: 1 }).size).toBe(0);
  });

  it('업비트 가격', () => {
    const p = parseUpbitPrices([{ market: 'KRW-XRP', trade_price: 1756 }, { market: 'KRW-USDT', trade_price: 1348 }, { market: 'KRW-BAD', trade_price: 'x' }]);
    expect(Object.fromEntries(p)).toEqual({ XRP: 1756, USDT: 1348 });
  });

  it('코인게코 아이콘: 코인게코 이미지 주소만, 같은 이름은 시총 순위 높은 쪽', () => {
    const icons = parseCoinGecko([
      { symbol: 'btc', image: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400', market_cap_rank: 1 },
      { symbol: 'uni', image: 'https://coin-images.coingecko.com/coins/images/2/large/fake.png', market_cap_rank: 900 },
      { symbol: 'uni', image: 'https://coin-images.coingecko.com/coins/images/12504/large/uni.jpg', market_cap_rank: 30 },
      { symbol: 'evil', image: 'https://evil.example/x.png', market_cap_rank: 5 },
      { symbol: 'js', image: 'javascript:alert(1)', market_cap_rank: 5 },
    ]);
    expect(icons.get('BTC')).toBe('https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png?1696501400');
    expect(icons.get('UNI')).toContain('/12504/');
    expect(icons.has('EVIL')).toBe(false);
    expect(icons.has('JS')).toBe(false);
  });
});
