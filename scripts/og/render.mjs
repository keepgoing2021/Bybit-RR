// 공유 미리보기 이미지(1200×630)를 scripts/og/og.html 에서 public/og.png 로 만든다.
// 실행: node scripts/og/render.mjs  (Chromium 경로를 바꾸려면 PW_CHROMIUM_PATH)
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(here, 'og.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(200);
const out = join(here, '..', '..', 'public', 'og.png');
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
