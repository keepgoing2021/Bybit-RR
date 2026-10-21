/**
 * 패널 카드 머리의 작은 선 아이콘 (16×16, 글자색을 따름).
 * 그림이 곧 카드의 일: 가격 선 세 줄 = 진입·손절·목표, 과녁 = 목표·손익비, 겹친 판 = 분할 진입,
 * 계기판 = 손익·포지션 규모, 방패 = 스탑 털림 방지, 원 안의 i = 자동 제안 근거
 */
const PATHS = {
  levels:
    '<path d="M2 4h12M2 8h12M2 12h12" opacity=".45"/><circle cx="5" cy="4" r="1.7" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r="1.7" fill="currentColor" stroke="none"/><circle cx="7.5" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  target: '<circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3.1"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/>',
  split: '<path d="M8 1.9 14 5.1 8 8.3 2 5.1Z"/><path d="M2 8.2 8 11.4 14 8.2"/><path d="M2 11 8 14.2 14 11"/>',
  gauge: '<path d="M2.4 12a5.6 5.6 0 0 1 11.2 0"/><path d="M8 12 11 7.6"/><circle cx="8" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  shield: '<path d="M8 1.8 13.2 3.8v3.9c0 3.1-2.2 5.3-5.2 6.5-3-1.2-5.2-3.4-5.2-6.5V3.8Z"/><path d="m5.7 7.9 1.6 1.6 3-3.1"/>',
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.3v4"/><circle cx="8" cy="4.9" r=".95" fill="currentColor" stroke="none"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = 'pc-icon'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  // 고정된 그림 문자열만 넣는다 (사용자 입력 없음)
  span.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}
