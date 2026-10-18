/** 호가 단위의 소수 자릿수. 1e-7 같은 지수 표기 값도 처리한다. */
export function decimalsOf(tick: number): number {
  for (let d = 0; d <= 12; d++) {
    const scaled = tick * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 12;
}

/** 가장 가까운 호가 단위로 맞춘다. 결과는 부동소수 잡음이 없는 십진 값. */
export function snapToTick(price: number, tick: number): number {
  return Number((Math.round(price / tick) * tick).toFixed(decimalsOf(tick)));
}

export function ticksBetween(a: number, b: number, tick: number): number {
  return Math.round(Math.abs(a - b) / tick);
}

export function formatPrice(price: number, tick: number): string {
  return price.toFixed(decimalsOf(tick));
}
