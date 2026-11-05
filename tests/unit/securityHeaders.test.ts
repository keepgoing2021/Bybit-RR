import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 배포 사이트의 보안 머리글 (public/_headers → Cloudflare 정적 파일 응답). 실제 적용은 wrangler dev로 확인했다.
const headers = readFileSync('public/_headers', 'utf8');
const csp = headers.match(/Content-Security-Policy: (.+)/)![1];
const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

describe('site security headers (public/_headers)', () => {
  it('scripts only from this site; no framing; no plugins; HTTPS and nosniff', () => {
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    for (const h of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Strict-Transport-Security: max-age=']) expect(headers).toContain(h);
  });

  it('allows exactly the outside hosts the app talks to (Bybit REST + websocket, Upbit, CoinGecko); fonts come from this site only', () => {
    const config = readFileSync('src/config.ts', 'utf8');
    const rest = config.match(/'(https:\/\/api\.bybit\.com)'/)![1];
    const wsHost = new URL(config.match(/'(wss:\/\/[^']+)'/)![1].replace('wss:', 'https:')).host;
    // 종목 리스트의 업비트(한글 이름·김프)·코인게코(아이콘) 공개 API (src/data/coinMeta.ts, 2026-11-05)
    const meta = readFileSync('src/data/coinMeta.ts', 'utf8');
    const metaHosts = [...meta.matchAll(/'(https:\/\/api\.[a-z]+\.com)\/(?:v1|api\/v3)'/g)].map((m) => m[1]);
    expect(metaHosts.sort()).toEqual(['https://api.coingecko.com', 'https://api.upbit.com']);
    expect(directive('connect-src').split(' ').slice(1).sort()).toEqual(["'self'", rest, `wss://${wsHost}`, ...metaHosts].sort());
    // 바깥 그림은 코인게코 아이콘 서버 하나만 (src/core/coinMeta.ts에서 주소 모양도 확인)
    expect(directive('img-src')).toBe("img-src 'self' data: blob: https://coin-images.coingecko.com");
    // 글꼴(Pretendard)은 npm 패키지를 빌드에 넣어 이 사이트에서 내보낸다 — 바깥 글꼴 서버 없음
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toContain("@import 'pretendard/");
    expect(css).not.toMatch(/https?:\/\//);
    expect(directive('style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive('font-src')).toBe("font-src 'self'");
  });

  it('index.html has no inline script (the policy would block it): the theme runs from /theme-init.js before the CSS', () => {
    const html = readFileSync('index.html', 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc=/);
      expect(body.trim()).toBe('');
    }
    expect(html.indexOf('/theme-init.js')).toBeLessThan(html.indexOf('/src/main.ts'));
    expect(readFileSync('public/theme-init.js', 'utf8')).toContain("'rrtool.v1.theme'");
  });
});
