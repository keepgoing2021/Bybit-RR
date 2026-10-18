import type { AutoLevels } from '../../../src/core/analysis';
import { createScenario, type Scenario } from '../../../src/core/scenario';
import { DEFAULT_SETTINGS } from '../../../src/core/settings';

export function autoLevels(sl: number | null, tp: number | null): AutoLevels {
  return {
    sl: {
      price: sl, candidatePrice: sl, status: sl === null ? 'invalid' : 'ok', reason: sl === null ? '유효한 자동 SL 없음' : null,
      candle: null, score: null, atr: null, timeframe: '15', bufferTicks: 0, method: 'prevCandle',
    },
    tp: {
      price: tp, candidatePrice: tp, status: tp === null ? 'unavailable' : 'ok', reason: null,
      swing: null, timeframe: '60',
    },
  };
}

export function makeScenario(sl: number | null = 98, tp: number | null = 106, side: 'LONG' | 'SHORT' = 'LONG'): Scenario {
  return createScenario({
    id: 's1',
    symbol: 'BTCUSDT',
    timeframe: '15',
    htf: '60',
    side,
    entry: { price: 100, priceTime: 1_000, source: 'trade', clickedAt: 1_200 },
    tickSize: 0.01,
    auto: autoLevels(sl, tp),
    settings: DEFAULT_SETTINGS,
  });
}
