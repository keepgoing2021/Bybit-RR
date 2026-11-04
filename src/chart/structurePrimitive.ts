import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { MarketStructure } from '../core/structure';
import type { DrawMapper } from './drawingGeometry';
import { THEME } from './theme';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/**
 * 다우 이론 시장 구조 표시 (2026-11-04). 손익비 박스·작도보다 아래에 깐다.
 * - 스윙 이름 HH·HL·LH·LL: 작고 흐리게 (차트를 가리지 않게)
 * - BOS(추세 계속): 깨진 스윙 → 깬 봉까지 흐린 점선
 * - CHoCH(추세 전환): 같은 자리 실선, 상승 전환 초록·하락 전환 빨강, 굵은 이름표 「추세전환 ▲/▼」(사용자 요청, 영어 약어 대신)
 */
export class StructurePrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private model: MarketStructure | null = null;
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

  set(model: MarketStructure | null): void {
    this.model = model;
    this.requestUpdate?.();
  }

  get(): MarketStructure | null {
    return this.model;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: DrawTarget): void {
    const m = this.mapper();
    const s = this.model;
    if (!m || !s) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.textAlign = 'center';

      for (const b of s.breaks) {
        const x1 = m.toX(b.fromTime);
        const x2 = m.toX(b.time);
        const y = m.toY(b.price);
        if (x1 === null || x2 === null || y === null) continue;
        const choch = b.type === 'CHoCH';
        const color = choch ? (b.dir === 'up' ? THEME.profit : THEME.loss) : THEME.textMuted;
        ctx.strokeStyle = color;
        ctx.globalAlpha = choch ? 0.95 : 0.6;
        ctx.lineWidth = choch ? 1.5 : 1;
        ctx.setLineDash(choch ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, Math.round(y) + 0.5);
        ctx.lineTo(x2, Math.round(y) + 0.5);
        ctx.stroke();
        // 이름표: 위로 깨면 선 위, 아래로 깨면 선 아래
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = `${choch ? 700 : 500} ${choch ? 11 : 10}px ${THEME.font}`;
        ctx.textBaseline = b.dir === 'up' ? 'bottom' : 'top';
        const text = choch ? `추세전환 ${b.dir === 'up' ? '▲' : '▼'}` : 'BOS';
        ctx.fillText(text, (x1 + x2) / 2, b.dir === 'up' ? y - 3 : y + 3);
      }

      ctx.globalAlpha = 0.75;
      ctx.font = `500 10px ${THEME.font}`;
      for (const p of s.points) {
        if (!p.label) continue;
        const x = m.toX(p.time);
        const y = m.toY(p.price);
        if (x === null || y === null || x < -20 || x > m.width + 20) continue;
        // 더 높은 고점·더 높은 저점은 초록 기운, 더 낮은 쪽은 빨강 기운 — 글자는 작게
        ctx.fillStyle = p.label === 'HH' || p.label === 'HL' ? THEME.profit : THEME.loss;
        ctx.textBaseline = p.kind === 'high' ? 'bottom' : 'top';
        ctx.fillText(p.label, x, p.kind === 'high' ? y - 6 : y + 6);
      }
      ctx.restore();
    });
  }
}
