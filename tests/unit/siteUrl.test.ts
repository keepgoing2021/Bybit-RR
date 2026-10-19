import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, siteUrl } from '../../vite.config';

describe('siteUrl (absolute address for link previews)', () => {
  it('SITE_URL first, then the Vercel production domain, then the default', () => {
    expect(siteUrl({ SITE_URL: 'https://1rc.xyz/', VERCEL_PROJECT_PRODUCTION_URL: 'bybit-rr.vercel.app' })).toBe('https://1rc.xyz');
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'rc1.fun' })).toBe('https://rc1.fun');
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'https://rc1.fun/' })).toBe('https://rc1.fun');
    expect(siteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe('https://bybit-rr.vercel.app');
  });
});
