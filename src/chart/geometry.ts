import type { PresetLevel } from '../core/presets';
import type { Side } from '../core/types';

export interface CoordMapper {
  priceToY(price: number): number | null;
  logicalToX(logical: number): number | null;
}

export interface BoxInput {
  side: Side;
  entry: number;
  sl: number | null;
  tp: number | null;
  /** 박스 왼쪽 끝 (시나리오 생성 봉의 논리 인덱스) */
  startLogical: number;
  /** 박스 오른쪽 끝 (최신 봉 + 연장 봉 수) */
  endLogical: number;
  /** 손익비 점선 (누르면 그 가격으로 TP 설정). 엔트리에서 바깥쪽 순서 */
  presets?: PresetLevel[];
  /** 2차 이후 분할 진입 가격선 */
  splits?: SplitLine[];
  /** 분할별 예상 평단 (2차 체결 시 … 전부 체결 시). 분할이 없으면 없음 */
  avgLines?: AvgLine[];
  /** 스탑헌팅존 (SL 기준 꼬리 끝에서 2~10% 바깥). 가로는 박스와 같은 폭 */
  hunt?: HuntInput | null;
}

export interface HuntInput {
  near: number;
  far: number;
  label: string;
  /** 지금 SL이 구간 안 (이름표를 경고색으로) */
  slInside: boolean;
}

export interface HuntGeometry {
  /** 왼쪽·오른쪽 끝 = 박스와 같음 */
  x: number;
  x2: number;
  yNear: number;
  yFar: number;
  label: string;
  slInside: boolean;
  /** 마지막으로 그린 방식 (검증용): 띠 / 화면 끝 칩만 / 안 그림 */
  drawn?: 'band' | 'edge' | null;
  /** 마지막으로 그린 해골 이름표 자리와, 피한 이름표(목표·손절·손익비) 자리 (검증용) */
  chip?: Rect | null;
  avoided?: Rect[];
}

export interface AvgLine {
  price: number;
  label: string;
  /** 박스가 좁을 때 쓰는 짧은 이름표 (예: '2차 63513.7') */
  short: string;
  /** 전부 체결 시 평단 (가장 강조) */
  final: boolean;
}

export interface SplitLine {
  price: number;
  label: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoxGeometry {
  x1: number;
  x2: number;
  yEntry: number;
  ySl: number | null;
  yTp: number | null;
  /** 엔트리 ~ TP (반투명 초록) */
  profit: Rect | null;
  /** 엔트리 ~ SL (반투명 빨강) */
  loss: Rect | null;
  handles: { sl: Rect | null; tp: Rect | null };
  presets: (PresetLevel & { y: number })[];
  /** 분할 가격선. showLabel=false면 이름표가 엔트리·다른 분할과 겹쳐서 선만 그린다 (10분할 등) */
  splits: (SplitLine & { y: number; showLabel: boolean })[];
  /** 분할별 예상 평단 선. showLabel=false면 이름표가 다른 것과 겹쳐서 선만 그린다 */
  avgLines: (AvgLine & { y: number; showLabel: boolean })[];
  hunt: HuntGeometry | null;
}

export const HANDLE_SIZE = 10;

/**
 * 시간·가격 좌표로 정의된 박스를 현재 화면 좌표로 바꾼다.
 * 확대·스크롤 때마다 다시 호출되므로 도형은 항상 같은 시간·가격에 붙어 있다.
 */
export function computeBoxGeometry(i: BoxInput, m: CoordMapper): BoxGeometry | null {
  const xa = m.logicalToX(i.startLogical);
  const xb = m.logicalToX(i.endLogical);
  const yEntry = m.priceToY(i.entry);
  if (xa === null || xb === null || yEntry === null) return null;
  const x1 = Math.min(xa, xb);
  const x2 = Math.max(xa, xb);
  const ySl = i.sl === null ? null : m.priceToY(i.sl);
  const yTp = i.tp === null ? null : m.priceToY(i.tp);

  const band = (y: number | null): Rect | null =>
    y === null ? null : { x: x1, y: Math.min(y, yEntry), w: x2 - x1, h: Math.abs(y - yEntry) };
  const handle = (y: number | null): Rect | null =>
    y === null ? null : { x: x1 - HANDLE_SIZE / 2, y: y - HANDLE_SIZE / 2, w: HANDLE_SIZE, h: HANDLE_SIZE };

  return {
    x1,
    x2,
    yEntry,
    ySl,
    yTp,
    profit: band(yTp),
    loss: band(ySl),
    handles: { sl: handle(ySl), tp: handle(yTp) },
    presets: spaced(i.presets ?? [], m, yEntry),
    ...labeledInside(i, m, yEntry, x2 - x1),
    hunt: huntGeometry(i.hunt ?? null, m, x1, x2),
  };
}

function huntGeometry(h: HuntInput | null, m: CoordMapper, x1: number, x2: number): HuntGeometry | null {
  if (!h) return null;
  const yNear = m.priceToY(h.near);
  const yFar = m.priceToY(h.far);
  if (yNear === null || yFar === null) return null;
  return { x: x1, x2, yNear, yFar, label: h.label, slInside: h.slInside };
}

/**
 * 박스 너비가 이보다 좁으면 왼쪽 분할 이름표가 가운데 손익비 칩·오른쪽 평단 칩과 가로로 겹친다.
 * 그때는 셋이 한 줄(세로)을 나눠 쓰듯 서로 피한다.
 */
export const NARROW_BOX = 210;
/** 평단 칩(높이 16) 중심 ↔ 엔트리의 손익비 칩(높이 20) 중심 최소 거리 */
const AVG_ENTRY_GAP = 20;
/** 분할 이름표(선 위 2~12px, 중심 = 선 − 7) 중심 ↔ 손익비 칩 중심 / 평단 칩 중심 최소 거리 */
const SPLIT_LABEL_OFFSET = 7;
const SPLIT_ENTRY_GAP = 17;
const SPLIT_AVG_GAP = 15;

/**
 * 박스 안 이름표 자리 정하기. 우선순위: 전부 체결 평단(항상) > 다른 평단 > 분할 이름표.
 * 선은 모두 그리고, 겹칠 이름표만 숨긴다 (10분할처럼 촘촘할 때).
 */
function labeledInside(
  i: BoxInput,
  m: CoordMapper,
  yEntry: number,
  width: number,
): { avgLines: (AvgLine & { y: number; showLabel: boolean })[]; splits: (SplitLine & { y: number; showLabel: boolean })[] } {
  const narrow = width < NARROW_BOX;
  const avgLines = (i.avgLines ?? []).flatMap((l) => {
    const y = m.priceToY(l.price);
    return y === null ? [] : [{ ...l, y, showLabel: false }];
  });
  const avgShown: number[] = [];
  for (const l of [...avgLines.filter((p) => p.final), ...avgLines.filter((p) => !p.final)]) {
    const free = Math.abs(l.y - yEntry) >= AVG_ENTRY_GAP && avgShown.every((y) => Math.abs(y - l.y) >= PRESET_MIN_GAP);
    if (l.final || free) {
      l.showLabel = true;
      avgShown.push(l.y);
    }
  }

  // 분할 이름표: 엔트리에서 SL 쪽 순서로, 엔트리선·앞 이름표와 14px. 좁은 박스면 손익비 칩·평단 칩도 피한다
  let last = yEntry;
  const splits = (i.splits ?? []).flatMap((p) => {
    const y = m.priceToY(p.price);
    if (y === null) return [];
    const c = y - SPLIT_LABEL_OFFSET;
    const showLabel =
      Math.abs(y - last) >= PRESET_MIN_GAP &&
      (!narrow || (Math.abs(c - yEntry) >= SPLIT_ENTRY_GAP && avgShown.every((ya) => Math.abs(c - ya) >= SPLIT_AVG_GAP)));
    if (showLabel) last = y;
    return [{ ...p, y, showLabel }];
  });
  return { avgLines, splits };
}

/** 점선 사이 최소 간격 (px). 이보다 가까우면 이름표가 겹치므로 그 점선은 그리지 않는다 */
export const PRESET_MIN_GAP = 14;

function spaced(presets: PresetLevel[], m: CoordMapper, yEntry: number): (PresetLevel & { y: number })[] {
  const out: (PresetLevel & { y: number })[] = [];
  let last = yEntry;
  for (const p of presets) {
    const y = m.priceToY(p.price);
    if (y === null || Math.abs(y - last) < PRESET_MIN_GAP) continue;
    out.push({ ...p, y });
    last = y;
  }
  return out;
}

/** 점선 오른쪽 끝의 이름표 칩 영역 (px). 여기서는 더 넓게 눌린다 */
export const PRESET_LABEL_ZONE = 56;

/** 박스 가로 범위 안에서 점선(또는 오른쪽 이름표 칩) 위인지 (가장 가까운 것) */
export function hitTestPreset(g: BoxGeometry, x: number, y: number, tol = 4): (PresetLevel & { y: number }) | null {
  if (x < g.x1 || x > g.x2) return null;
  const reach = x >= g.x2 - PRESET_LABEL_ZONE ? Math.max(tol, 9) : tol;
  let best: (PresetLevel & { y: number }) | null = null;
  for (const p of g.presets) {
    const d = Math.abs(p.y - y);
    if (d <= reach && (!best || d < Math.abs(best.y - y))) best = p;
  }
  return best;
}

/** SL·TP 선(박스 가로 범위 안) 또는 핸들 위인지. 둘 다 가까우면 더 가까운 쪽. */
export function hitTest(g: BoxGeometry, x: number, y: number, tol = 6): 'sl' | 'tp' | null {
  let best: { which: 'sl' | 'tp'; dist: number } | null = null;
  const consider = (which: 'sl' | 'tp', ly: number | null, h: Rect | null) => {
    if (ly === null) return;
    let dist = Infinity;
    if (h && x >= h.x - 2 && x <= h.x + h.w + 2 && y >= h.y - 2 && y <= h.y + h.h + 2) dist = Math.abs(y - ly);
    else if (x >= g.x1 - tol && x <= g.x2 + tol && Math.abs(y - ly) <= tol) dist = Math.abs(y - ly);
    if (dist !== Infinity && (!best || dist < best.dist)) best = { which, dist };
  };
  consider('sl', g.ySl, g.handles.sl);
  consider('tp', g.yTp, g.handles.tp);
  return best === null ? null : (best as { which: 'sl' | 'tp' }).which;
}
