import { describe, expect, it } from 'vitest';
import { buildId, DEFAULT_SITE_URL, siteUrl } from '../../vite.config';

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

describe('buildId (which commit is deployed, in <meta name="1rc-build">)', () => {
  it('Cloudflare Workers Builds commit first, then git, then "dev"', () => {
    const noGit = () => {
      throw new Error('no git');
    };
    expect(buildId({ WORKERS_CI_COMMIT_SHA: '18b69c4f00ddba11' }, noGit)).toBe('18b69c4');
    expect(buildId({}, () => '6243b38\n')).toBe('6243b38');
    expect(buildId({}, noGit)).toBe('dev');
    expect(buildId({}, () => '')).toBe('dev');
  });
});
