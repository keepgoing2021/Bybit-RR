import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, siteUrl } from '../../vite.config';

describe('siteUrl (absolute address for link previews)', () => {
  it('SITE_URL first, then the default (Cloudflare Workers since 2026-10-19)', () => {
    expect(siteUrl({ SITE_URL: 'https://1rc.xyz/' })).toBe('https://1rc.xyz');
    expect(siteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe('https://1rc.app');
  });

  it('ignores Vercel variables now that the site is not on Vercel', () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'rc1.fun' })).toBe(DEFAULT_SITE_URL);
  });
});
