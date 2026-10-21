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

  it('allows exactly the outside hosts the app talks to (Bybit REST + websocket, Google Fonts)', () => {
    const config = readFileSync('src/config.ts', 'utf8');
    const rest = config.match(/'(https:\/\/api\.bybit\.com)'/)![1];
    const wsHost = new URL(config.match(/'(wss:\/\/[^']+)'/)![1].replace('wss:', 'https:')).host;
    expect(directive('connect-src').split(' ').slice(1).sort()).toEqual(["'self'", rest, `wss://${wsHost}`].sort());
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toContain('https://fonts.googleapis.com/');
    expect(directive('style-src')).toContain('https://fonts.googleapis.com');
    expect(directive('font-src')).toContain('https://fonts.gstatic.com');
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
