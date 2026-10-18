import { decimalsOf, snapToTick } from './price';
import type { Side } from './types';

export type SplitCount = 1 | 3 | 5;
/** linear: 금액 1:2:3(:4:5) / equalRisk: 분할마다 SL 손실이 같도록 */
export type WeightMode = 'linear' | 'equalRisk';

export interface SizingSettings {
  /** 운영자산 (USDT). 입력 전이면 null */
  capital: number | null;
  /** 모든 분할이 체결된 뒤 SL에 맞았을 때의 손실 한도 (운영자산 대비 %) */
  riskPct: number;
  splits: SplitCount;
  weightMode: WeightMode;
}

export const DEFAULT_SIZING: SizingSettings = { capital: null, riskPct: 1, splits: 3, weightMode: 'linear' };
export const RISK_PCT_RANGE: [number, number] = [0.1, 10];

export function sanitizeSizing(raw: unknown): SizingSettings {
  const src = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: SizingSettings = { ...DEFAULT_SIZING };
  if (typeof src.capital === 'number' && Number.isFinite(src.capital) && src.capital > 0) out.capital = src.capital;
  if (typeof src.riskPct === 'number' && Number.isFinite(src.riskPct)) {
    out.riskPct = Math.min(RISK_PCT_RANGE[1], Math.max(RISK_PCT_RANGE[0], src.riskPct));
  }
  if (src.splits === 1 || src.splits === 3 || src.splits === 5) out.splits = src.splits;
  if (src.weightMode === 'linear' || src.weightMode === 'equalRisk') out.weightMode = src.weightMode;
  return out;
}

/** 분할 진입 가격: 엔트리~SL 거리를 n등분 (LONG·SHORT 같은 식). 1차 = 엔트리, 마지막도 SL보다 한 칸 앞 */
export function splitPrices(_side: Side, entry: number, sl: number, n: number, tickSize: number): number[] {
  return Array.from({ length: n }, (_, k) => snapToTick(entry - (k / n) * (entry - sl), tickSize));
}

/** 분할별 금액 비중 (합 1). linear는 k+1에 비례, equalRisk는 SL 손실이 같도록 가격/손절폭에 비례 */
export function splitShares(prices: number[], sl: number, mode: WeightMode): number[] {
  const raw = prices.map((p, k) => (mode === 'linear' ? k + 1 : p / Math.abs(p - sl)));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / total);
}

export interface SizingInput {
  side: Side;
  entry: number;
  sl: number | null;
  tp: number | null;
  tickSize: number;
  /** 거래소 수량 단위 (없으면 반올림하지 않음) */
  qtyStep?: number;
  minQty?: number;
  /** 최소 주문 금액 (USDT) */
  minNotional?: number;
  settings: SizingSettings;
}

export interface Tranche {
  /** 1차, 2차, … */
  n: number;
  price: number;
  /** 실제 금액 비중 (수량 단위 반올림 후) */
  share: number;
  /** 포지션 금액 (USDT, 레버리지 전 명목 금액) */
  notional: number;
  qty: number;
  /** 이 분할이 SL에서 잃는 금액 */
  loss: number;
  /** 거래소 최소 주문 수량·금액 미만 */
  tooSmall: boolean;
}

export interface SizingPlan {
  tranches: Tranche[];
  /** 손실 한도 = 운영자산 × riskPct */
  riskBudget: number;
  totalNotional: number;
  totalQty: number;
  /** 모든 분할 체결 시 평균 진입가 */
  avgEntry: number;
  /** 모든 분할 체결 후 SL 도달 시 손실 (한도 이하) */
  lossAtSl: number;
  lossPct: number;
  /** 모든 분할 체결 후 TP 도달 시 수익. TP가 없거나 반대편이면 null */
  profitAtTp: number | null;
  profitPct: number | null;
  rr: number | null;
  /** 총 포지션 금액 ÷ 운영자산 (필요한 최소 레버리지) */
  leverage: number;
}

export type SizingResult = { ok: true; plan: SizingPlan } | { ok: false; reason: string };

function floorToStep(x: number, step: number | undefined): number {
  if (!step || step <= 0) return x;
  return Number((Math.floor(x / step + 1e-9) * step).toFixed(decimalsOf(step)));
}

/**
 * 분할 진입 계획. 모든 분할이 체결된 뒤 SL에 맞아도 손실이 운영자산의 riskPct%를 넘지 않게
 * 총 포지션을 정하고, 비중대로 나눈다. 수수료·슬리피지·펀딩비는 넣지 않는다.
 */
export function planSizing(i: SizingInput): SizingResult {
  const { side, entry, sl, tp, tickSize, settings } = i;
  const { capital, riskPct, splits, weightMode } = settings;
  if (capital === null || !(capital > 0)) return { ok: false, reason: '운영자산을 입력하면 분할별 금액을 계산합니다' };
  if (sl === null) return { ok: false, reason: 'SL을 정하면 분할별 금액을 계산합니다' };
  const sign = side === 'LONG' ? 1 : -1;
  if (!(sign * (entry - sl) > 0)) {
    return { ok: false, reason: `SL이 엔트리 ${side === 'LONG' ? '아래' : '위'}에 있어야 분할별 금액을 계산합니다` };
  }
  if (Math.round(Math.abs(entry - sl) / tickSize) < splits) {
    return { ok: false, reason: `엔트리와 SL이 너무 가까워 ${splits}분할로 나눌 수 없습니다` };
  }

  const prices = splitPrices(side, entry, sl, splits, tickSize);
  const shares = splitShares(prices, sl, weightMode);
  const riskBudget = (capital * riskPct) / 100;
  // 금액 1당 SL 손실 = 손절폭 ÷ 가격
  const lossPerNotional = shares.reduce((acc, w, k) => acc + (w * Math.abs(prices[k] - sl)) / prices[k], 0);
  const total = riskBudget / lossPerNotional;

  const rows = prices.map((price, k) => {
    const qty = floorToStep((shares[k] * total) / price, i.qtyStep);
    return { price, qty, notional: qty * price, loss: qty * Math.abs(price - sl) };
  });
  const totalNotional = rows.reduce((a, r) => a + r.notional, 0);
  const totalQty = rows.reduce((a, r) => a + r.qty, 0);
  const lossAtSl = rows.reduce((a, r) => a + r.loss, 0);
  const tpValid = tp !== null && sign * (tp - entry) > 0;
  const profitAtTp = tpValid ? rows.reduce((a, r) => a + r.qty * sign * (tp - r.price), 0) : null;

  const tranches: Tranche[] = rows.map((r, k) => ({
    n: k + 1,
    price: r.price,
    share: totalNotional > 0 ? r.notional / totalNotional : 0,
    notional: r.notional,
    qty: r.qty,
    loss: r.loss,
    tooSmall: r.qty <= 0 || (i.minQty !== undefined && r.qty < i.minQty) || (i.minNotional !== undefined && r.notional < i.minNotional),
  }));

  return {
    ok: true,
    plan: {
      tranches,
      riskBudget,
      totalNotional,
      totalQty,
      avgEntry: totalQty > 0 ? totalNotional / totalQty : entry,
      lossAtSl,
      lossPct: (lossAtSl / capital) * 100,
      profitAtTp,
      profitPct: profitAtTp === null ? null : (profitAtTp / capital) * 100,
      rr: profitAtTp === null || lossAtSl <= 0 ? null : profitAtTp / lossAtSl,
      leverage: totalNotional / capital,
    },
  };
}
