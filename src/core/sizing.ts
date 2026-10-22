import { decimalsOf, snapToTick } from './price';
import type { Side } from './types';

/** 분할 수 1 ~ MAX_SPLITS */
export type SplitCount = number;
export const MAX_SPLITS = 10;
/** linear: 금액 1:2:3(:4:5) / equalRisk: 분할마다 SL 손실이 같도록 */
export type WeightMode = 'linear' | 'equalRisk' | 'custom';

/**
 * 포지션 크기를 정하는 방식 (상단 바 둘째 칸의 스위치):
 * - value = 투입금: 넣을 돈(주문 금액, Bybit '주문 금액(Value)'과 같은 뜻 — 레버리지 곱하기 전)을 정하면 손절 시 손실을 계산
 * - risk  = 자산 %: 손절 시 총 자산의 몇 %를 잃을지 정하면 넣을 돈을 거꾸로 계산 (TradingView 포지션 도구와 같은 방식)
 */
export type SizeMode = 'value' | 'risk';

export interface SizingSettings {
  /** 총 자산(에쿼티, USDT). 입력 전이면 null */
  capital: number | null;
  /** 자산 % 방식: 모든 분할이 체결된 뒤 SL에 맞았을 때의 손실 한도 (총 자산 대비 %) */
  riskPct: number;
  /** 포지션 크기를 정하는 방식 */
  sizeMode: SizeMode;
  /** 투입금 방식: 넣을 돈 (모든 분할의 주문 금액 합, USDT). null이면 총 자산 전부 */
  positionValue: number | null;
  splits: SplitCount;
  weightMode: WeightMode;
  /** weightMode 'custom'의 비율 (예: [1, 1, 2]). 개수 = 분할 수 */
  customWeights: number[];
  /** 차트에 '체결 시 예상 평단' 점선을 그릴지 */
  showAvgLine: boolean;
}

export const DEFAULT_SIZING: SizingSettings = {
  capital: null,
  riskPct: 1,
  sizeMode: 'value',
  positionValue: null,
  splits: 3,
  weightMode: 'linear',
  customWeights: [],
  showAvgLine: true,
};
export const RISK_PCT_RANGE: [number, number] = [0.1, 10];

export function sanitizeSizing(raw: unknown): SizingSettings {
  const src = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: SizingSettings = { ...DEFAULT_SIZING };
  if (typeof src.capital === 'number' && Number.isFinite(src.capital) && src.capital > 0) out.capital = src.capital;
  if (typeof src.riskPct === 'number' && Number.isFinite(src.riskPct)) {
    out.riskPct = Math.min(RISK_PCT_RANGE[1], Math.max(RISK_PCT_RANGE[0], src.riskPct));
  }
  if (src.sizeMode === 'value' || src.sizeMode === 'risk') out.sizeMode = src.sizeMode;
  if (typeof src.positionValue === 'number' && Number.isFinite(src.positionValue) && src.positionValue > 0) out.positionValue = src.positionValue;
  if (Number.isInteger(src.splits) && (src.splits as number) >= 1 && (src.splits as number) <= MAX_SPLITS) out.splits = src.splits as number;
  if (src.weightMode === 'linear' || src.weightMode === 'equalRisk' || src.weightMode === 'custom') out.weightMode = src.weightMode;
  const cw = src.customWeights;
  if (Array.isArray(cw) && cw.length >= 1 && cw.length <= MAX_SPLITS && cw.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0)) {
    out.customWeights = [...(cw as number[])];
  }
  // 직접 입력한 비중은 칸 수가 곧 분할 수. 비중이 없으면 기본(점점 크게)으로
  if (out.weightMode === 'custom') {
    if (out.customWeights.length) out.splits = out.customWeights.length;
    else out.weightMode = 'linear';
  }
  if (typeof src.showAvgLine === 'boolean') out.showAvgLine = src.showAvgLine;
  return out;
}

/** 분할 진입 가격: 엔트리~SL 거리를 n등분 (LONG·SHORT 같은 식). 1차 = 엔트리, 마지막도 SL보다 한 칸 앞 */
export function splitPrices(_side: Side, entry: number, sl: number, n: number, tickSize: number): number[] {
  return Array.from({ length: n }, (_, k) => snapToTick(entry - (k / n) * (entry - sl), tickSize));
}

/** 분할별 금액 비중 (합 1). linear는 k+1에 비례, equalRisk는 SL 손실이 같도록 가격/손절폭에 비례, custom은 입력한 비율 */
export function splitShares(prices: number[], sl: number, mode: WeightMode, custom: number[] = []): number[] {
  const raw = prices.map((p, k) => (mode === 'linear' ? k + 1 : mode === 'custom' ? custom[k] ?? 1 : p / Math.abs(p - sl)));
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
  /** 1차부터 이 분할까지 체결됐을 때의 평단 (1차 = 진입가, 마지막 = 전부 체결) */
  avgIfFilled: number;
}

export interface SizingPlan {
  tranches: Tranche[];
  /** 손실 한도: 자산 % 방식 = 총 자산 × riskPct, 투입금 방식 = 넣은 돈이 SL에서 잃는 금액 */
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
  /** 투입금 ÷ 총 자산 (필요한 최소 레버리지) */
  leverage: number;
}

export type SizingResult = { ok: true; plan: SizingPlan } | { ok: false; reason: string };

function floorToStep(x: number, step: number | undefined): number {
  if (!step || step <= 0) return x;
  return Number((Math.floor(x / step + 1e-9) * step).toFixed(decimalsOf(step)));
}

/**
 * 분할 진입 계획. 포지션 크기(모든 분할의 주문 금액 합)는
 * - 투입금 방식: 정한 투입금 그대로 (비우면 총 자산 전부)
 * - 자산 % 방식: 모든 분할이 체결된 뒤 SL에 맞아도 손실이 총 자산의 riskPct%가 되게
 * 로 정하고, 비중대로 나눈다. 수수료·슬리피지·펀딩비는 넣지 않는다.
 */
export function planSizing(i: SizingInput): SizingResult {
  const { side, entry, sl, tp, tickSize, settings } = i;
  const { capital, riskPct, splits, weightMode } = settings;
  if (capital === null || !(capital > 0)) return { ok: false, reason: '총 자산을 입력하면 분할별 금액을 계산합니다' };
  if (sl === null) return { ok: false, reason: 'SL을 정하면 분할별 금액을 계산합니다' };
  const sign = side === 'LONG' ? 1 : -1;
  if (!(sign * (entry - sl) > 0)) {
    return { ok: false, reason: `SL이 엔트리 ${side === 'LONG' ? '아래' : '위'}에 있어야 분할별 금액을 계산합니다` };
  }
  if (Math.round(Math.abs(entry - sl) / tickSize) < splits) {
    return { ok: false, reason: `엔트리와 SL이 너무 가까워 ${splits}분할로 나눌 수 없습니다` };
  }

  const prices = splitPrices(side, entry, sl, splits, tickSize);
  const shares = splitShares(prices, sl, weightMode, settings.customWeights);
  // 금액 1당 SL 손실 = 손절폭 ÷ 가격
  const lossPerNotional = shares.reduce((acc, w, k) => acc + (w * Math.abs(prices[k] - sl)) / prices[k], 0);
  const byValue = (settings.sizeMode ?? 'risk') === 'value';
  const total = byValue ? (settings.positionValue ?? capital) : (capital * riskPct) / 100 / lossPerNotional;
  const riskBudget = byValue ? total * lossPerNotional : (capital * riskPct) / 100;

  const rows = prices.map((price, k) => {
    const qty = floorToStep((shares[k] * total) / price, i.qtyStep);
    return { price, qty, notional: qty * price, loss: qty * Math.abs(price - sl) };
  });
  const totalNotional = rows.reduce((a, r) => a + r.notional, 0);
  const totalQty = rows.reduce((a, r) => a + r.qty, 0);
  const lossAtSl = rows.reduce((a, r) => a + r.loss, 0);
  const tpValid = tp !== null && sign * (tp - entry) > 0;
  const profitAtTp = tpValid ? rows.reduce((a, r) => a + r.qty * sign * (tp - r.price), 0) : null;

  let cumNotional = 0;
  let cumQty = 0;
  const tranches: Tranche[] = rows.map((r, k) => {
    cumNotional += r.notional;
    cumQty += r.qty;
    return {
    n: k + 1,
    price: r.price,
    share: totalNotional > 0 ? r.notional / totalNotional : 0,
    notional: r.notional,
    qty: r.qty,
    loss: r.loss,
    tooSmall: r.qty <= 0 || (i.minQty !== undefined && r.qty < i.minQty) || (i.minNotional !== undefined && r.notional < i.minNotional),
    avgIfFilled: cumQty > 0 ? cumNotional / cumQty : r.price,
    };
  });

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

/** 직접 입력한 비중 '1:1:2', '20/30/50', '1, 2, 3', '1 2 3' → [..]. 0 이하·숫자 아님·MAX_SPLITS 초과는 null */
/**
 * 분할이 전부 체결된 뒤 가격 tp에서 청산했을 때의 수익 (USDT, 수수료 전).
 * 손익비 칩 아래 금액: 칩이 TP를 옮길 자리마다 이 값을 보여 준다
 */
export function profitAt(plan: Pick<SizingPlan, 'tranches'>, side: Side, tp: number): number {
  const sign = side === 'LONG' ? 1 : -1;
  return plan.tranches.reduce((a, t) => a + t.qty * sign * (tp - t.price), 0);
}

export function parseWeights(text: string): number[] | null {
  const t = text.trim();
  if (t === '') return null;
  const parts = t.split(/\s*[:/,]\s*|\s+/);
  if (parts.length > MAX_SPLITS || parts.some((x) => x === '')) return null;
  const nums = parts.map(Number);
  return nums.every((n) => Number.isFinite(n) && n > 0) ? nums : null;
}

/** 점점 크게(1:2:…:n) 비율 */
export function linearRatio(n: number): number[] {
  return Array.from({ length: n }, (_, k) => k + 1);
}

/** 비중 이름표: 5분할까지는 1:2:3:4:5, 그 이상은 1:2:…:n */
export function ratioLabel(n: number): string {
  return n <= 5 ? linearRatio(n).join(':') : `1:2:…:${n}`;
}

/** 분할 수 칸 입력 → 1~MAX_SPLITS 정수, 아니면 null */
export function parseSplitCount(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_SPLITS ? n : null;
}

/** 비중 칸에 적는 '분할별 손실 균등' 단어 ('균등'만 적어도 된다) */
export const EQUAL_RISK_WORD = '손실 균등';

/** 비중 칸에 보여줄 글: 점점 크게 = 1:2:…:N, 손실 균등 = '손실 균등', 직접 입력 = 그 비율 */
export function weightsText(s: SizingSettings): string {
  if (s.weightMode === 'equalRisk') return EQUAL_RISK_WORD;
  if (s.weightMode === 'custom') return s.customWeights.map(String).join(':');
  return linearRatio(s.splits).join(':');
}

/**
 * 비중 칸 입력 읽기. '균등'이 들어가면 분할별 손실 균등(분할 수 그대로),
 * 비율이면 칸 수 = 분할 수이고 1:2:…:n과 같으면 '점점 크게', 아니면 직접 입력. 잘못된 글은 null
 */
export function readWeightsInput(
  text: string,
  splits: number,
): Pick<SizingSettings, 'weightMode' | 'splits'> & { customWeights?: number[] } | null {
  if (/균등/.test(text)) return { weightMode: 'equalRisk', splits };
  const w = parseWeights(text);
  if (!w) return null;
  if (w.length === 1 || w.every((x, k) => x === k + 1)) return { weightMode: 'linear', splits: w.length };
  return { weightMode: 'custom', customWeights: w, splits: w.length };
}

/**
 * 분할 수만 바꾸기. 점점 크게·손실 균등은 그대로 n분할,
 * 직접 입력한 비율은 자르거나 마지막 값으로 채운다 (1회 진입이면 비율이 필요 없어 점점 크게로)
 */
export function resizeSplits(s: SizingSettings, n: number): SizingSettings {
  if (s.weightMode !== 'custom') return { ...s, splits: n };
  if (n === 1) return { ...s, splits: 1, weightMode: 'linear' };
  const cw = s.customWeights;
  return { ...s, splits: n, customWeights: Array.from({ length: n }, (_, k) => cw[Math.min(k, cw.length - 1)] ?? 1) };
}

/**
 * Bybit USDT 무기한 기본 수수료 (등급별, 지정가 = 메이커 · 시장가 = 테이커).
 * 출처: Bybit 도움말 'Trading Fee Structure'(2026-09-02 갱신)·'Benefits of the VIP Program'(2026-10-12 갱신)의 파생상품 표.
 * 지역·이노베이션 존 종목은 다를 수 있다
 */
export const FEE_TIERS = ['vip0', 'vip1', 'vip2', 'vip3', 'vip4', 'vip5'] as const;
export type FeeTier = (typeof FEE_TIERS)[number];
export const FEE_RATES: Record<FeeTier, { label: string; maker: number; taker: number }> = {
  vip0: { label: '일반', maker: 0.0002, taker: 0.00055 },
  vip1: { label: 'VIP1', maker: 0.00018, taker: 0.0004 },
  vip2: { label: 'VIP2', maker: 0.00016, taker: 0.000375 },
  vip3: { label: 'VIP3', maker: 0.00014, taker: 0.00035 },
  vip4: { label: 'VIP4', maker: 0.00012, taker: 0.00032 },
  vip5: { label: 'VIP5', maker: 0.0001, taker: 0.00032 },
};
export const DEFAULT_FEE_TIER: FeeTier = 'vip0';
/** 기본 등급(일반) 수수료 */
export const FEE_MAKER = FEE_RATES.vip0.maker;
export const FEE_TAKER = FEE_RATES.vip0.taker;

export function isFeeTier(v: unknown): v is FeeTier {
  return typeof v === 'string' && (FEE_TIERS as readonly string[]).includes(v);
}

/** 0.00018 → '0.018%' (Bybit 표처럼, 끝의 0은 지움) */
export function feePctText(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

/**
 * 전부 체결된 뒤 SL에 맞았을 때 내는 수수료와, 그것이 손실(가격 손실)에서 차지하는 비율(%).
 * 진입은 지정가(메이커), 손절은 시장가(테이커)로 가정. 손실이 0이면 비율은 null
 */
export function feeAtStop(
  plan: Pick<SizingPlan, 'totalNotional' | 'lossAtSl'>,
  tier: FeeTier = DEFAULT_FEE_TIER,
): { fee: number; sharePct: number | null } {
  const r = FEE_RATES[tier];
  const fee = plan.totalNotional * (r.maker + r.taker);
  return { fee, sharePct: plan.lossAtSl > 0 ? (fee / plan.lossAtSl) * 100 : null };
}
