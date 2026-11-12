import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { fmtRatio, fmtUsdShort, type VolumePeak } from '../core/volumePeak';
import type { DrawMapper } from './drawingGeometry';
import { THEME } from './theme';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** 이름표가 그려진 자리 (시험·겹침 확인용, 차트 영역 기준 px) */
export interface VolumePeakBox {
  time: number;
  usd: number;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 캔들 위쪽에 붙였는지 (자리가 없으면 아래) */
  above: boolean;
  /** 이름표를 눌러 가격 구간 선(고가·저가 점선)을 펼쳤는지 */
  open: boolean;
  /** 가격 구간 (고가~저가를 오른쪽으로 늘린 자리). 선은 open일 때만 그린다 */
  band: { x1: number; x2: number; yTop: number; yBottom: number };
}

const LABEL_H = 17;
const GAP = 7;
/** 이름표 누름 범위 여유 (손가락으로도 눌리게) */
const HIT_PAD = 8;
/** 이름표끼리 이만큼은 떨어져야 둘 다 그린다 */
const LABEL_GAP = 6;

/**
 * 하루 중 거래대금이 가장 큰 캔들에 「🔥 $35.2M」 이름표 (2026-11-11).
 * 캔들 고가 위에 붙이고, 위에 자리가 없으면 저가 아래. 손익비 박스·작도보다 아래에 깐다.
 * 평소에는 이름표만 (2026-11-12: 늘 깔리던 옅은 띠가 거슬려서 뺐다). 이름표를 누르면 그 캔들의 고가·저가에
 * 점선 2줄이 오른쪽(다음 날 끝까지)으로 나오고, 다시 누르면 꺼진다 — 거래가 몰린 가격대라 손절·목표의 기준이 된다
 */
export class VolumePeakPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private peaks: readonly VolumePeak[] = [];
  private boxes: VolumePeakBox[] = [];
  /** 가격 구간 선을 펼친 캔들 (시각) */
  private readonly opened = new Set<number>();
  private readonly views: readonly IPrimitivePaneView[];

  constructor(private readonly mapper: () => DrawMapper | null) {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    this.views = [{ zOrder: () => 'normal', renderer: () => renderer }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  set(peaks: readonly VolumePeak[]): void {
    this.peaks = peaks;
    if (!peaks.length) this.boxes = [];
    for (const t of this.opened) if (!peaks.some((p) => p.time === t)) this.opened.delete(t);
    this.requestUpdate?.();
  }

  get(): readonly VolumePeak[] {
    return this.peaks;
  }

  /** 마지막으로 그린 이름표 자리 */
  drawn(): readonly VolumePeakBox[] {
    return this.boxes;
  }

  /** (x, y)가 이름표 위면 그 캔들의 가격 구간 선을 켜고 끈다. 이름표를 눌렀으면 true */
  toggleAt(x: number, y: number): boolean {
    const b = this.boxes.find((q) => x >= q.x - HIT_PAD && x <= q.x + q.w + HIT_PAD && y >= q.y - HIT_PAD && y <= q.y + q.h + HIT_PAD);
    if (!b) return false;
    if (!this.opened.delete(b.time)) this.opened.add(b.time);
    this.requestUpdate?.();
    return true;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: DrawTarget): void {
    const m = this.mapper();
    if (!m || !this.peaks.length) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const boxes: VolumePeakBox[] = [];
      ctx.save();
      ctx.font = `700 11px ${THEME.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 1) 자리 계산. 이름표끼리 겹치면 거래대금이 큰 쪽만 남긴다 (넓게 봐도 캔들을 덮지 않게)
      type Item = { p: VolumePeak; x: number; yHigh: number; yLow: number; text: string; w: number; left: number; top: number; above: boolean; bx1: number; bx2: number; yTop: number; yBottom: number };
      const items: Item[] = [];
      for (const p of this.peaks) {
        const x = m.toX(p.time);
        const yHigh = m.toY(p.high);
        const yLow = m.toY(p.low);
        if (x === null || yHigh === null || yLow === null) continue;
        const text = `🔥 ${p.approx ? '≈' : ''}${fmtUsdShort(p.usd)}${p.ratio !== null && p.ratio >= 1.05 ? ` · ${fmtRatio(p.ratio)}` : ''}`;
        const w = Math.ceil(ctx.measureText(text).width) + 12;
        if (x + w / 2 < 0 || x - w / 2 > m.width) continue;
        // 가격 구간: 캔들부터 다음 날(주) 끝까지 (화면 밖은 자른다)
        const xEnd = m.toX(p.bandEnd);
        const above = yHigh - GAP - LABEL_H >= 2;
        items.push({
          p, x, yHigh, yLow, text, w, above,
          left: Math.round(x - w / 2),
          top: Math.round(above ? yHigh - GAP - LABEL_H : yLow + GAP),
          bx1: Math.max(0, x),
          bx2: Math.min(m.width, xEnd ?? m.width),
          yTop: Math.min(yHigh, yLow),
          yBottom: Math.max(yHigh, yLow),
        });
      }
      const kept: Item[] = [];
      for (const it of [...items].sort((a, b) => b.p.usd - a.p.usd)) {
        const hit = kept.some((k) => it.left < k.left + k.w + LABEL_GAP && k.left < it.left + it.w + LABEL_GAP && it.top < k.top + LABEL_H + LABEL_GAP && k.top < it.top + LABEL_H + LABEL_GAP);
        if (!hit) kept.push(it);
      }
      kept.sort((a, b) => a.p.time - b.p.time);
      // 2) 그리기
      for (const { p, x, yHigh, yLow, text, w, left, top, above, bx1, bx2, yTop, yBottom } of kept) {
        const open = this.opened.has(p.time);
        if (open && bx2 > bx1) {
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = THEME.entry;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(bx1, Math.round(yTop) + 0.5);
          ctx.lineTo(bx2, Math.round(yTop) + 0.5);
          ctx.moveTo(bx1, Math.round(yBottom) + 0.5);
          ctx.lineTo(bx2, Math.round(yBottom) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // 캔들까지 짧은 선
        ctx.strokeStyle = THEME.entry;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, above ? top + LABEL_H : top);
        ctx.lineTo(Math.round(x) + 0.5, above ? yHigh - 1 : yLow + 1);
        ctx.stroke();
        // 이름표
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = THEME.entry;
        ctx.beginPath();
        ctx.roundRect(left, top, w, LABEL_H, 5);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#14161a';
        ctx.fillText(text, left + w / 2, top + LABEL_H / 2 + 0.5);
        boxes.push({ time: p.time, usd: p.usd, text, x: left, y: top, w, h: LABEL_H, above, open, band: { x1: bx1, x2: bx2, yTop, yBottom } });
      }
      ctx.restore();
      this.boxes = boxes;
    });
  }
}
