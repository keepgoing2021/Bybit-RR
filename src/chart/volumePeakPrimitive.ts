import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { fmtUsdShort, type VolumePeak } from '../core/volumePeak';
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
}

const LABEL_H = 17;
const GAP = 7;

/**
 * 하루 중 거래대금이 가장 큰 캔들에 「🔥 $35.2M」 이름표 (2026-11-11).
 * 캔들 고가 위에 붙이고, 위에 자리가 없으면 저가 아래. 손익비 박스·작도보다 아래에 깐다
 */
export class VolumePeakPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private peaks: readonly VolumePeak[] = [];
  private boxes: VolumePeakBox[] = [];
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
    this.requestUpdate?.();
  }

  get(): readonly VolumePeak[] {
    return this.peaks;
  }

  /** 마지막으로 그린 이름표 자리 */
  drawn(): readonly VolumePeakBox[] {
    return this.boxes;
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
      for (const p of this.peaks) {
        const x = m.toX(p.time);
        const yHigh = m.toY(p.high);
        const yLow = m.toY(p.low);
        if (x === null || yHigh === null || yLow === null) continue;
        const text = `🔥 ${p.approx ? '≈' : ''}${fmtUsdShort(p.usd)}`;
        const w = Math.ceil(ctx.measureText(text).width) + 12;
        if (x + w / 2 < 0 || x - w / 2 > m.width) continue;
        const above = yHigh - GAP - LABEL_H >= 2;
        const top = above ? yHigh - GAP - LABEL_H : yLow + GAP;
        const left = Math.round(x - w / 2);
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
        ctx.roundRect(left, Math.round(top), w, LABEL_H, 5);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#14161a';
        ctx.fillText(text, left + w / 2, Math.round(top) + LABEL_H / 2 + 0.5);
        boxes.push({ time: p.time, usd: p.usd, text, x: left, y: Math.round(top), w, h: LABEL_H, above });
      }
      ctx.restore();
      this.boxes = boxes;
    });
  }
}
