/** 화면 테마: 다크(기본, 검정 바탕) / 라이트 */
export type ThemeMode = 'dark' | 'light';

const FONT = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

/** 차트 색. CSS 변수(src/styles.css의 :root / [data-theme='light'])와 같은 값을 쓴다 */
export interface Palette {
  bg: string;
  panel: string;
  grid: string;
  line: string;
  text: string;
  textMuted: string;
  profit: string;
  loss: string;
  entry: string;
  warning: string;
  profitFill: string;
  lossFill: string;
  highlight: string;
  /** 박스 위 이름표 바탕 (가운데 손익비·분할 평단 칩 등) */
  chipDark: string;
  /** 색 칩(목표·손절·엔트리) 위 글자, 전부 체결 평단 칩 글자 */
  chipText: string;
  /** 강조 선·글자: 캔들 꼬리, 예상 평단 선, 선택 테두리 (다크 = 흰색, 라이트 = 거의 검정) */
  ink: string;
  /** 평단 칩 테두리 */
  inkSoft: string;
  /** 마우스가 올라간 손익비 칩 바탕 */
  chipHot: string;
  /** 스탑헌팅존: 바탕 · 빗금 · 경계 점선 · 이름표(해골·글자). 보라 (MA100의 연보라보다 진하게) */
  huntFill: string;
  huntHatch: string;
  huntEdge: string;
  huntText: string;
  font: string;
}

export const DARK: Palette = {
  bg: '#000000',
  panel: '#0B0C0F',
  grid: '#14171C',
  line: '#262A31',
  text: '#E6E8EB',
  textMuted: '#8B929C',
  profit: '#2EBD85',
  loss: '#F0616D',
  entry: '#E8B44C',
  warning: '#F2C46D',
  profitFill: 'rgba(46, 189, 133, 0.16)',
  lossFill: 'rgba(240, 97, 109, 0.16)',
  highlight: 'rgba(232, 180, 76, 0.13)',
  chipDark: 'rgba(0, 0, 0, 0.88)',
  chipText: '#0E1420',
  ink: '#FFFFFF',
  inkSoft: 'rgba(255, 255, 255, 0.7)',
  chipHot: '#123A2C',
  huntFill: 'rgba(139, 92, 246, 0.1)',
  huntHatch: 'rgba(139, 92, 246, 0.55)',
  huntEdge: 'rgba(167, 139, 250, 0.9)',
  huntText: '#B79CFF',
  font: FONT,
};

export const LIGHT: Palette = {
  bg: '#FFFFFF',
  panel: '#F5F6F8',
  grid: '#EEF0F3',
  line: '#DDE1E6',
  text: '#14171C',
  textMuted: '#5D6673',
  profit: '#12A06B',
  loss: '#E03E4D',
  entry: '#C4870C',
  warning: '#B86E00',
  profitFill: 'rgba(18, 160, 107, 0.13)',
  lossFill: 'rgba(224, 62, 77, 0.11)',
  highlight: 'rgba(196, 135, 12, 0.12)',
  chipDark: 'rgba(255, 255, 255, 0.94)',
  chipText: '#FFFFFF',
  ink: '#14171C',
  inkSoft: 'rgba(20, 23, 28, 0.55)',
  chipHot: '#DDF3EA',
  huntFill: 'rgba(124, 58, 237, 0.07)',
  huntHatch: 'rgba(124, 58, 237, 0.45)',
  huntEdge: 'rgba(109, 40, 217, 0.85)',
  huntText: '#6D28D9',
  font: FONT,
};

/**
 * 지금 쓰는 색. 그리는 코드는 그릴 때마다 THEME.x를 읽으므로 setThemeMode로 값만 바꾸면 된다
 * (차트 옵션은 ChartView.setTheme이 다시 적용).
 */
export const THEME: Palette = { ...DARK };

export function setThemeMode(mode: ThemeMode): void {
  Object.assign(THEME, mode === 'light' ? LIGHT : DARK);
}

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'dark' || v === 'light';
}
