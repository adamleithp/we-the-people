/**
 * Renders the glass-intro shatter to video with an alpha channel — a PNG
 * sequence (After Effects / Premiere / Resolve import it directly) plus a
 * ProRes 4444 .mov when ffmpeg is on PATH.
 *
 *   npm i --no-save playwright-core
 *   npm run shatter -- --title "We The|People"
 *   npm run shatter -- --title "Join Us" --variant page --fps 60 --size 26vh
 *
 * It starts the Astro dev server, opens `/capture/<variant>` (the real
 * <GlassIntro> geometry and keyframes, on a transparent page), pauses every
 * animation and seeks it to each frame's time before screenshotting. The clock
 * is ours, not the browser's, so no frame is ever dropped or late.
 *
 * Motion blur: a browser has no shutter, so each frame is the average of
 * `--samples` sub-frames spread across `--shutter` degrees (180° = film). The
 * average is taken in premultiplied alpha, so blurred edges fade to transparent
 * rather than to a dark fringe. `--samples 1` turns it off (fast previews).
 *
 * Options (defaults in brackets):
 *   --title     lines split on "|"                         ["We The|People"]
 *   --variant   hero (cinematic, 42 shards) | page (fast, 20 shards) [hero]
 *   --size      wordmark size, any CSS length               [the site's own]
 *   --width/--height  frame size in CSS px                  [1920×1080]
 *   --scale     device pixel ratio; 2 → 3840×2160           [2]
 *   --fps                                                    [30]
 *   --hold      seconds of the assembled title after it lands [1.5]
 *   --samples   motion-blur sub-frames per frame             [8]
 *   --shutter   shutter angle in degrees                     [180]
 *   --out       output directory        [renders/<title>-<variant>-<fps>fps]
 *   --url       use an already-running dev server instead of starting one
 *   --no-prores skip the ffmpeg step
 *
 * CHROMIUM=/path/to/chrome overrides the browser playwright-core resolves.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values: opt } = parseArgs({
  options: {
    title: { type: 'string', default: 'We The|People' },
    variant: { type: 'string', default: 'hero' },
    size: { type: 'string' },
    width: { type: 'string', default: '1920' },
    height: { type: 'string', default: '1080' },
    scale: { type: 'string', default: '2' },
    fps: { type: 'string', default: '30' },
    hold: { type: 'string', default: '1.5' },
    samples: { type: 'string', default: '8' },
    shutter: { type: 'string', default: '180' },
    out: { type: 'string' },
    url: { type: 'string' },
    'no-prores': { type: 'boolean', default: false },
  },
});

if (!['hero', 'page'].includes(opt.variant)) throw new Error('--variant must be hero or page');
const width = Number(opt.width);
const height = Number(opt.height);
const scale = Number(opt.scale);
const fps = Number(opt.fps);
const samples = Math.max(1, Math.round(Number(opt.samples)));
const shutter = Number(opt.shutter) / 360; // fraction of a frame the shutter is open
const slug = opt.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outDir = join(root, opt.out ?? join('renders', `${slug}-${opt.variant}-${fps}fps`));
const framesDir = join(outDir, 'frames');

const { chromium } = await import('playwright-core').catch(() => {
  throw new Error('playwright-core is not installed — run: npm i --no-save playwright-core');
});

// --- dev server -------------------------------------------------------------

let server;
let base = opt.url?.replace(/\/$/, '');
if (!base) {
  const port = 4399;
  base = `http://127.0.0.1:${port}`;
  server = spawn(
    join(root, 'node_modules', '.bin', 'astro'),
    ['dev', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  server.stdout.resume();
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error('astro dev exited before it was ready');
    if (Date.now() > deadline) throw new Error(`astro dev did not answer on ${base}`);
    const ok = await fetch(`${base}/capture/${opt.variant}`).then((r) => r.ok, () => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 300));
  }
}
const stopServer = () => server?.kill();
process.on('exit', stopServer);
process.on('SIGINT', () => process.exit(130));

// --- capture ----------------------------------------------------------------

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: scale,
  reducedMotion: 'no-preference',
});

const query = new URLSearchParams({ title: opt.title });
if (opt.size) query.set('size', opt.size);
await page.goto(`${base}/capture/${opt.variant}?${query}`, { waitUntil: 'load' });
await page.waitForSelector('html[data-capture-ready]');
await page.evaluate(() => document.fonts.ready);

// A wordmark in the fallback font is a wasted render — refuse it. The Fonts API
// fetches Anton from Google on first run; offline or blocked, it quietly falls
// back to Arial Narrow.
const anton = await page.evaluate(async () => {
  const el = document.querySelector('[data-intro] .wtp-wordmark');
  await document.fonts.load(`16px ${getComputedStyle(el).fontFamily}`, el.textContent);
  return [...document.fonts].some(
    (f) => /anton/i.test(f.family) && !/fallback/i.test(f.family) && f.status === 'loaded',
  );
});
if (!anton) {
  throw new Error(
    'Anton did not load, so the title would render in the fallback font. The Astro Fonts ' +
      'API fetches it from fonts.google.com — check the dev server log for a fetch error.',
  );
}

// Freeze the clock. From here on the page only moves when we seek it.
const landMs = await page.evaluate(() => {
  for (const a of document.getAnimations()) a.pause();
  return Number(document.querySelector('[data-intro]').dataset.land);
});
if (!landMs) throw new Error('no glass intro on the capture page');

const seek = (ms) =>
  page.evaluate((t) => {
    for (const a of document.getAnimations()) a.currentTime = t;
  }, ms);

const frameCount = Math.ceil(((landMs / 1000) + Number(opt.hold)) * fps) + 1;
const px = { width: Math.round(width * scale), height: Math.round(height * scale) };
const pxCount = px.width * px.height;

await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });

/** RGBA screenshot at `ms`, decoded to raw (straight-alpha) pixels. */
async function grab(ms) {
  await seek(ms);
  const png = await page.screenshot({ omitBackground: true, type: 'png' });
  return sharp(png).ensureAlpha().raw().toBuffer();
}

const acc = new Float32Array(pxCount * 4);
let landedFile = null; // once every shard has landed, frames are identical
const started = Date.now();

for (let f = 0; f < frameCount; f++) {
  const file = join(framesDir, `frame_${String(f).padStart(4, '0')}.png`);
  const t0 = (f / fps) * 1000;

  if (landedFile) {
    await copyFile(landedFile, file);
    continue;
  }

  let out;
  if (samples === 1) {
    out = await grab(t0);
  } else {
    // Sub-frames across the open shutter, accumulated premultiplied.
    acc.fill(0);
    for (let s = 0; s < samples; s++) {
      const buf = await grab(t0 + ((s / samples) * shutter * 1000) / fps);
      for (let i = 0; i < acc.length; i += 4) {
        const a = buf[i + 3];
        if (a === 0) continue;
        acc[i] += buf[i] * a;
        acc[i + 1] += buf[i + 1] * a;
        acc[i + 2] += buf[i + 2] * a;
        acc[i + 3] += a;
      }
    }
    out = Buffer.alloc(acc.length);
    for (let i = 0; i < acc.length; i += 4) {
      const a = acc[i + 3];
      if (a === 0) continue;
      out[i] = Math.round(acc[i] / a);
      out[i + 1] = Math.round(acc[i + 1] / a);
      out[i + 2] = Math.round(acc[i + 2] / a);
      out[i + 3] = Math.round(a / samples);
    }
  }

  await sharp(out, { raw: { ...px, channels: 4 } }).png().toFile(file);
  if (t0 >= landMs) landedFile = file;

  const eta = ((Date.now() - started) / (f + 1)) * (frameCount - f - 1);
  process.stdout.write(
    `\rframe ${f + 1}/${frameCount}  ~${Math.ceil(eta / 1000)}s left   `,
  );
}
process.stdout.write('\n');

await browser.close();
stopServer();

await writeFile(
  join(outDir, 'render.json'),
  JSON.stringify(
    {
      title: opt.title,
      variant: opt.variant,
      fps,
      frames: frameCount,
      size: px,
      landsAtFrame: Math.ceil((landMs / 1000) * fps),
      samples,
      shutterDeg: Number(opt.shutter),
    },
    null,
    2,
  ) + '\n',
);

// --- ProRes 4444 ----------------------------------------------------------

const rel = (p) => relative(process.cwd(), p) || '.';
const mov = join(outDir, `${slug}-${opt.variant}.mov`);
const ffmpegArgs = [
  '-y',
  '-framerate', String(fps),
  '-i', join(framesDir, 'frame_%04d.png'),
  '-c:v', 'prores_ks',
  '-profile:v', '4444',
  '-pix_fmt', 'yuva444p10le',
  '-alpha_bits', '16',
  '-vendor', 'apl0',
  mov,
];

console.log(`PNG sequence (alpha): ${rel(framesDir)}/  (${frameCount} frames, ${px.width}×${px.height}, ${fps}fps)`);
if (opt['no-prores']) process.exit(0);

// ProRes 4444 from FFmpeg < 7 plays with an opaque alpha on Apple Silicon (Resolve,
// Final Cut, Premiere): the title lands on black. See src/lib/prores.ts.
const ffVersion = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { encoding: 'utf8' }).stdout ?? '';
const ffMajor = Number(/ffmpeg version n?(\d+)/.exec(ffVersion)?.[1]);
if (ffMajor && ffMajor < 7) {
  console.warn(`\nffmpeg ${ffMajor}.x found — its ProRes alpha shows as black on Apple Silicon Macs. Upgrade to ffmpeg 7+.\n`);
}
const ff = spawnSync(process.env.FFMPEG || 'ffmpeg', ffmpegArgs, { stdio: 'inherit' });
if (ff.error || ff.status !== 0) {
  console.log(
    '\nffmpeg not available — the PNG sequence is complete. For a single ProRes 4444 file:\n' +
      `  ffmpeg ${ffmpegArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n` +
      '(macOS: brew install ffmpeg)',
  );
} else {
  console.log(`ProRes 4444 (alpha):  ${rel(mov)}`);
}
