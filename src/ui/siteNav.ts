/**
 * 페이지 메뉴 (2026-11-11): PC는 왼쪽 세로 줄, 폰은 맨 아래 탭바. 차트·매매일지 두 화면이 같은 것을 쓴다.
 * 큰 아이콘 + 글자라 처음 온 사람도 '화면이 둘'이라는 걸 바로 안다. 진행 중인 가상 거래 수는 배지로
 */
export type SitePage = 'chart' | 'journal';

export interface SiteNav {
  root: HTMLElement;
  /** 진행 중인 가상 거래 수 (0이면 배지 숨김) */
  setOpenCount(n: number): void;
}

const ITEMS: { page: SitePage; href: string; icon: string; label: string; testid: string }[] = [
  { page: 'chart', href: '/', icon: '📈', label: '차트', testid: 'nav-chart' },
  { page: 'journal', href: '/journal', icon: '📒', label: '매매일지', testid: 'journal-link' },
];

export function siteNav(current: SitePage): SiteNav {
  const root = document.createElement('nav');
  root.className = 'site-nav';
  root.setAttribute('aria-label', '페이지');
  root.dataset.testid = 'site-nav';
  const badge = document.createElement('span');
  badge.className = 'site-nav-badge';
  badge.dataset.testid = 'journal-badge';
  badge.hidden = true;
  let journalItem: HTMLAnchorElement | null = null;
  for (const it of ITEMS) {
    const a = document.createElement('a');
    a.className = 'site-nav-item';
    a.href = it.href;
    a.dataset.testid = it.testid;
    if (it.page === current) {
      a.classList.add('on');
      a.setAttribute('aria-current', 'page');
    }
    const icon = document.createElement('span');
    icon.className = 'site-nav-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = it.icon;
    const label = document.createElement('span');
    label.className = 'site-nav-label';
    label.textContent = it.label;
    a.append(icon, label);
    if (it.page === 'journal') {
      a.append(badge);
      journalItem = a;
    }
    root.append(a);
  }
  return {
    root,
    setOpenCount(n: number): void {
      badge.hidden = n <= 0;
      badge.textContent = String(n);
      if (journalItem) journalItem.title = n > 0 ? `매매일지 · 진행 중 ${n}건` : '매매일지 (기록·통계·규칙)';
    },
  };
}
