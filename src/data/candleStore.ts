import type { Candle } from '../core/types';

/** 한 종목·한 시간봉의 캔들을 시간 오름차순으로 유지한다. REST 이력과 WS 갱신을 합친다. */
export class CandleStore {
  private candles: Candle[] = [];

  setAll(list: Candle[]): void {
    this.candles = [];
    for (const c of [...list].sort((a, b) => a.time - b.time)) {
      const last = this.candles[this.candles.length - 1];
      if (last && last.time === c.time) this.candles[this.candles.length - 1] = pick(last, c);
      else this.candles.push(c);
    }
  }

  upsert(c: Candle): 'append' | 'update' | 'insert' {
    const n = this.candles.length;
    if (n === 0 || c.time > this.candles[n - 1].time) {
      this.candles.push(c);
      return 'append';
    }
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = this.candles[mid].time;
      if (t === c.time) {
        this.candles[mid] = pick(this.candles[mid], c);
        return 'update';
      }
      if (t < c.time) lo = mid + 1;
      else hi = mid - 1;
    }
    this.candles.splice(lo, 0, c);
    return 'insert';
  }

  merge(list: Candle[]): void {
    for (const c of list) this.upsert(c);
  }

  all(): readonly Candle[] {
    return this.candles;
  }

  last(): Candle | undefined {
    return this.candles[this.candles.length - 1];
  }
}

/** 확정 캔들은 미확정 값으로 덮어쓰지 않는다. 그 외에는 새 값. */
function pick(existing: Candle, incoming: Candle): Candle {
  if (existing.confirmed && !incoming.confirmed) return existing;
  return incoming;
}
