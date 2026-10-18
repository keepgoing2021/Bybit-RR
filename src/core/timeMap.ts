/**
 * 캔들 시작 시각 배열 ↔ 차트 논리 인덱스 (봉 중앙이 정수). 봉 사이는 비율로, 마지막 봉 뒤·첫 봉 앞은
 * 시간봉 길이로 늘려 계산한다 — 작도가 미래(오른쪽 빈 곳)까지 닿을 수 있게.
 */
export function timeToLogical(times: readonly number[], tfMs: number, t: number): number | null {
  const n = times.length;
  if (n === 0) return null;
  if (t <= times[0]) return (t - times[0]) / tfMs;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / tfMs;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

export function logicalToTime(times: readonly number[], tfMs: number, l: number): number | null {
  const n = times.length;
  if (n === 0) return null;
  if (l <= 0) return times[0] + l * tfMs;
  if (l >= n - 1) return times[n - 1] + (l - (n - 1)) * tfMs;
  const i = Math.floor(l);
  return times[i] + (l - i) * (times[i + 1] - times[i]);
}
