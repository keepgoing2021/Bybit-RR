// 저장된 테마를 CSS보다 먼저 적용해 라이트 모드에서 검정 화면이 번쩍이지 않게 (키: rrtool.v1.theme).
// 보안 정책(CSP)이 페이지 안 스크립트를 막으므로 index.html 안이 아니라 이 파일로 둔다 (public/_headers)
try {
  if (localStorage.getItem('rrtool.v1.theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch (e) {}
