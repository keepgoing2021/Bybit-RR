/**
 * 최근 15분 거래대금·상승률 순위 (우측 위 '15분 순위판').
 * 전 종목 1분봉(진행 중 + 마감)을 받아 종목마다 최근 몇 개만 들고 있다가,
 * 이번 1분 + 직전 14분(= 최근 15분) 안의 봉으로 거래대금 합과 등락률을 낸다.
 * 상승률 줄은 '거래가 터지면서 오르는 코인': 평소보다 거래대금이 2배 이상 붙은 종목 중 많이 오른 순.
 * 평소 = 그 종목 24시간 거래대금을 같은 시간 길이로 나눈 평균 (예: 15분이면 24시간 거래대금 ÷ 96).
 */
export interface FlowBar {
  /** 1분봉 시작 시각 (ms) */
  start: number;
  open: number;
  close: number;
  /** 거래대금 (USDT) */
  turnover: number;
}

export interface FlowRow {
  symbol: string;
  /** 최근 15분 거래대금 합 (USDT) */
  turnover: number;
  /** 최근 15분 등락률 (%) = (마지막 종가 − 가장 이른 봉의 시가) ÷ 시가 */
  changePct: number;
  /** 평소의 몇 배 거래대금인지 = 15분 거래대금 ÷ (24시간 거래대금 ÷ 1440 × 모은 분). 24시간 값을 모르면 없음 */
  spike?: number;
}

export interface FlowRanking {
  volume: FlowRow[];
  gainers: FlowRow[];
  /** 몇 분치를 모았는지 (1~15). 연결 직후에는 15분이 안 찬다 (거래대금 상위 종목은 지난 봉을 미리 받아 채운다) */
  coverageMin: number;
}

const MIN = 60_000;
export const FLOW_WINDOW_MIN = 15;
/** 상승률 순위에 넣는 최소 상승률 (%). 소수 둘째 자리로 '+0.00%'가 될 만큼 작은 오름은 뺀다 */
export const FLOW_MIN_CHANGE_PCT = 0.005;
/** 상승률 순위에 넣는 거래 급증 기준: 평소의 몇 배 이상 */
export const FLOW_SPIKE_RATIO = 2;
/** 상승률 순위에 넣는 최소 15분 거래대금 (USDT): 평소 거래가 거의 없는 종목이 몇 건 체결로 '몇 배'가 되는 건 뺀다 */
export const FLOW_SPIKE_MIN_TURNOVER = 100_000;

export class FlowBook {
  private readonly bars = new Map<string, FlowBar[]>();
  /** 받은 봉 중 가장 이른 시작 시각 → 몇 분치를 모았는지 (Bybit는 연결 직후 이번 1분 봉부터 보낸다) */
  private earliestStart = Infinity;
  /** 받은 봉 중 가장 늦은 시작 시각 (브라우저 시계가 거래소보다 조금 늦어도 이번 1분을 놓치지 않게) */
  private latestStart = 0;
  /** 종목별 24시간 거래대금 (USDT): 평소 거래대금의 기준 */
  private readonly usual = new Map<string, number>();

  constructor(private readonly keep = FLOW_WINDOW_MIN + 1) {}

  /** 같은 시작 시각의 봉은 덮어쓴다 (진행 중 봉이 계속 갱신됨) */
  update(symbol: string, bar: FlowBar, _receivedAt?: number): void {
    if (!(bar.open > 0) || !Number.isFinite(bar.close) || !Number.isFinite(bar.turnover)) return;
    if (bar.start < this.earliestStart) this.earliestStart = bar.start;
    if (bar.start > this.latestStart) this.latestStart = bar.start;
    let list = this.bars.get(symbol);
    if (!list) this.bars.set(symbol, (list = []));
    const i = list.findIndex((b) => b.start === bar.start);
    if (i >= 0) list[i] = bar;
    else {
      list.push(bar);
      list.sort((a, b) => a.start - b.start);
      if (list.length > this.keep) list.splice(0, list.length - this.keep);
    }
  }

  /** 이 종목의 그 시작 시각 봉을 이미 들고 있는지 (미리 채우기가 웹소켓 봉을 덮지 않게) */
  has(symbol: string, start: number): boolean {
    return this.bars.get(symbol)?.some((b) => b.start === start) ?? false;
  }

  /** 24시간 거래대금을 넣는다 (시세를 새로 받을 때마다). 0 이하·모르는 값은 버린다 */
  setUsual(list: { symbol: string; turnover24h: number }[]): void {
    for (const t of list) {
      if (t.turnover24h > 0 && Number.isFinite(t.turnover24h)) this.usual.set(t.symbol, t.turnover24h);
      else this.usual.delete(t.symbol);
    }
  }

  clear(): void {
    this.bars.clear();
    this.usual.clear();
    this.earliestStart = Infinity;
    this.latestStart = 0;
  }

  rank(now: number, top = 3, windowMin = FLOW_WINDOW_MIN): FlowRanking {
    const ref = Math.max(now, this.latestStart);
    const from = Math.floor(ref / MIN) * MIN - (windowMin - 1) * MIN;
    const rows: FlowRow[] = [];
    for (const [symbol, list] of this.bars) {
      const inWin = list.filter((b) => b.start >= from);
      if (!inWin.length) continue;
      const open = inWin[0].open;
      const close = inWin[inWin.length - 1].close;
      const turnover = inWin.reduce((s, b) => s + b.turnover, 0);
      const row: FlowRow = { symbol, turnover, changePct: ((close - open) / open) * 100 };
      const day = this.usual.get(symbol);
      if (day) {
        // 모은 시간(분): 이 종목 첫 봉부터 지금까지 (연결 직후 몇 분치만 있으면 그만큼만 평소와 비교, 처음 1분은 1분으로)
        const minutes = Math.min(windowMin, Math.max(1, (ref - inWin[0].start) / MIN));
        row.spike = turnover / ((day / 1440) * minutes);
      }
      rows.push(row);
    }
    const byVolume = rows.filter((r) => r.turnover > 0).sort((a, b) => b.turnover - a.turnover || a.symbol.localeCompare(b.symbol));
    const volume = byVolume.slice(0, top);
    // 거래가 터지면서 오르는 코인: 평소의 2배 이상 + 15분 10만 USDT 이상 중 많이 오른 순
    const gainers = byVolume
      .filter((r) => r.changePct >= FLOW_MIN_CHANGE_PCT && (r.spike ?? 0) >= FLOW_SPIKE_RATIO && r.turnover >= FLOW_SPIKE_MIN_TURNOVER)
      .sort((a, b) => b.changePct - a.changePct || (b.spike ?? 0) - (a.spike ?? 0))
      .slice(0, top);
    const coverageMin = this.earliestStart === Infinity ? 0 : Math.min(windowMin, Math.floor((Math.floor(ref / MIN) * MIN - this.earliestStart) / MIN) + 1);
    return { volume, gainers, coverageMin };
  }
}

/** 'BTCUSDT' → 'BTC' (순위판은 좁아서 코인 이름만) */
export function baseName(symbol: string): string {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}
