import type { ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { THEME } from './theme';

export interface CountdownState {
  text: string;
  /** 현재가 (카운트다운은 이 가격 라벨 바로 아래에 붙는다) */
  price: number;
  up: boolean;
}

/** 오른쪽 가격축 현재가 라벨 아래 '캔들 마감까지 남은 시간' (TradingView 카운트다운과 같은 위치) */
export class CountdownPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private state: CountdownState | null = null;
  private readonly views: readonly ISeriesPrimitiveAxisView[];

  constructor() {
    this.views = [
      {
        coordinate: () => {
          const y = this.state ? this.series?.priceToCoordinate(this.state.price) ?? null : null;
          return y === null ? -100 : y + 19;
        },
        text: () => this.state?.text ?? '',
        textColor: () => '#ffffff',
        backColor: () => (this.state?.up ? THEME.profit : THEME.loss),
        visible: () => this.state !== null,
        tickVisible: () => false,
      },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.series = p.series as ISeriesApi<SeriesType>;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  set(state: CountdownState | null): void {
    const same = state?.text === this.state?.text && state?.price === this.state?.price && state?.up === this.state?.up;
    this.state = state;
    if (!same) this.requestUpdate?.();
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.views;
  }
}
