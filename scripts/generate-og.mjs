/**
 * Generates the Open Graph share images in `public/og/` — one per page, each the
 * page's title in the real wordmark on the site's off-black.
 *
 * The images are committed, so this only needs re-running when a title or the
 * lockup changes:
 *
 *   npm run og
 *
 * It renders with headless Chromium (so the Anton wordmark is pixel-identical to
 * the site) via playwright-core, which is NOT a project dependency — install it
 * ad-hoc if you need to regenerate:
 *
 *   npm i --no-save playwright-core
 *   OG_CHROMIUM=/path/to/chrome-headless-shell npm run og
 *
 * OG_CHROMIUM is optional; without it playwright-core resolves its own browser.
 */
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// WhatsApp/Slack/X all read 1200×630 happily, and it's the safest single size.
const WIDTH = 1200;
const HEIGHT = 630;

const IMAGES = [
  { file: 'default.png', lines: ['We The', 'People'], tagline: 'Reunite the Country · Transform the System' },
  { file: 'idea.png', lines: ['The Idea'], tagline: 'We The People · Section 01' },
  { file: 'practice.png', lines: ['In Practice'], tagline: 'We The People · Section 02' },
  { file: 'join.png', lines: ['Join Us'], tagline: 'We The People · Be part of hope' },
];

/** The Anton subset the Astro Fonts API already downloaded for the site. */
async function fontDataUri() {
  const dir = join(root, '.astro', 'fonts');
  const files = await readdir(dir).catch(() => []);
  const woff2 = files.find((f) => f.includes('anton') && f.endsWith('.woff2'));
  if (!woff2) {
    throw new Error(
      'No Anton woff2 in .astro/fonts — run `npm run build` first so the Fonts API downloads it.',
    );
  }
  const buf = await readFile(join(dir, woff2));
  return `data:font/woff2;base64,${buf.toString('base64')}`;
}

const html = (lines, tagline, font) => `<!doctype html>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Anton'; src: url('${font}') format('woff2'); font-display: block; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 34px; background: #0b0b0b; color: #fff;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  h1 {
    font-family: 'Anton', 'Arial Narrow', sans-serif; font-weight: 400;
    text-transform: uppercase; font-size: ${lines.length > 1 ? 190 : 150}px;
    line-height: 0.84; letter-spacing: 0.005em; text-align: center;
  }
  p {
    text-transform: uppercase; letter-spacing: 0.28em; font-size: 22px;
    color: rgba(246, 244, 238, 0.62); text-align: center;
  }
  .rule { width: 96px; height: 3px; background: #f2c14e; }
</style>
<h1>${lines.join('<br />')}</h1>
<div class="rule"></div>
<p>${tagline}</p>
`;

const { chromium } = await import('playwright-core').catch(() => {
  throw new Error('playwright-core is not installed — run: npm i --no-save playwright-core');
});

const font = await fontDataUri();
const outDir = join(root, 'public', 'og');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch(
  process.env.OG_CHROMIUM ? { executablePath: process.env.OG_CHROMIUM } : {},
);
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })).newPage();

for (const { file, lines, tagline } of IMAGES) {
  const tmp = join(outDir, `.${file}.html`);
  await writeFile(tmp, html(lines, tagline, font));
  await page.goto(`file://${tmp}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outDir, file) });
  await unlink(tmp);
  console.log(`og: ${file}`);
}

await browser.close();
