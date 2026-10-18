/** 차트 작도 (추세선·수평선·평행 채널·피보나치 되돌림). 점은 시간·가격 좌표라 확대·스크롤·시간봉과 무관하다 */
export type DrawingKind = 'trend' | 'hline' | 'channel' | 'fib';

export interface Anchor {
  /** ms. 마지막 캔들 뒤(미래)도 가능 */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  points: Anchor[];
  /** 선 색 (#RRGGBB). 없으면 기본색 (피보나치는 레벨별 기본 색) */
  color?: string;
}

/** 작도 색 견본 */
export const DRAW_PALETTE = ['#26C6DA', '#FFFFFF', '#F2C46D', '#2EBD85', '#F0616D', '#4C9AFF', '#C77DFF', '#FF9800'];

export const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

export const DRAWING_KINDS: DrawingKind[] = ['trend', 'hline', 'channel', 'fib'];

/** 도구별로 찍는 점 수 */
export const POINTS: Record<DrawingKind, number> = { trend: 2, hline: 1, channel: 3, fib: 2 };

export const DRAWING_NAMES: Record<DrawingKind, string> = {
  trend: '추세선',
  hline: '수평선',
  channel: '평행 채널',
  fib: '피보나치 되돌림',
};

/** 점을 찍을 때 안내 (n번째 점) */
export function placingHint(kind: DrawingKind, placed: number): string {
  const name = DRAWING_NAMES[kind];
  if (kind === 'hline') return `${name}: 가격을 누르세요`;
  if (kind === 'channel') return [`${name}: 시작점을 누르세요`, `${name}: 끝점을 누르세요`, `${name}: 폭을 정할 곳을 누르세요`][placed] ?? name;
  if (kind === 'fib') return placed === 0 ? `${name}: 시작점(1)을 누르세요` : `${name}: 끝점(0)을 누르세요`;
  return placed === 0 ? `${name}: 시작점을 누르세요` : `${name}: 끝점을 누르세요`;
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** 피보나치 되돌림 레벨 가격. TradingView와 같이 1 = 첫 점, 0 = 둘째 점 */
export function fibLevels(a: Anchor, b: Anchor): { level: number; price: number }[] {
  return FIB_LEVELS.map((level) => ({ level, price: b.price + (a.price - b.price) * level }));
}

/** 평행 채널: 기준선(p1→p2)을 가격으로 얼마나 옮겨야 p3를 지나는지 */
export function channelOffset(p1: Anchor, p2: Anchor, p3: Anchor): number {
  if (p2.time === p1.time) return p3.price - p1.price;
  const onLine = p1.price + ((p2.price - p1.price) * (p3.time - p1.time)) / (p2.time - p1.time);
  return p3.price - onLine;
}

export function setPoint(d: Drawing, index: number, a: Anchor): Drawing {
  return { ...d, points: d.points.map((p, i) => (i === index ? a : p)) };
}

export function mapPoints(d: Drawing, f: (a: Anchor) => Anchor): Drawing {
  return { ...d, points: d.points.map(f) };
}

/** 저장된 작도 { 종목: Drawing[] } 검증. 모양이 틀린 것은 버린다 */
export function sanitizeDrawings(raw: unknown): Record<string, Drawing[]> {
  const out: Record<string, Drawing[]> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [symbol, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    // 색이 잘못된 것은 색만 버린다
    const ok = list.filter(isDrawing).map((d) => {
      const { color, ...rest } = d;
      return isColor(color) ? { ...rest, color } : rest;
    });
    if (ok.length) out[symbol] = ok;
  }
  return out;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isDrawing(v: unknown): v is Drawing {
  if (v === null || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  if (typeof d.id !== 'string' || !(DRAWING_KINDS as unknown[]).includes(d.kind) || !Array.isArray(d.points)) return false;
  if (d.points.length !== POINTS[d.kind as DrawingKind]) return false;
  return d.points.every((p) => p !== null && typeof p === 'object' && fin((p as Anchor).time) && fin((p as Anchor).price));
}
