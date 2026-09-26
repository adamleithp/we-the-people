/**
 * ProRes 4444 with alpha, encoded in the browser by FFmpeg 9's `prores_ks`
 * through a custom libav.js build (`public/libav/`, made by
 * `scripts/build-libav.sh`).
 *
 * Why not ffmpeg.wasm: its core is FFmpeg 5.1, whose ProRes encoder predates the
 * FFmpeg 7.0 fixes (frame header version 1 for 4:4:4/alpha, the corrected DC/AC
 * codebooks and alpha run coding). Apple Silicon's ProRes decoder — used by
 * Resolve, Final Cut and Premiere on those Macs — reads such files with an
 * opaque alpha channel: the title arrives on black. FFmpeg's own decoder
 * doesn't mind, which is why the old files looked fine everywhere else.
 *
 * Frames go straight in as yuva444p10le — no PNG round trip. The title is one
 * colour, so Y/Cb/Cr are constant across the frame; only alpha changes.
 */
import type { RGB } from './glass-renderer';

const BASE = '/libav';
const FRONTEND = `${BASE}/libav-6.10.9.0-wtp-prores.mjs`;
/** AVPixelFormat AV_PIX_FMT_YUVA444P10LE in FFmpeg 9 (libavutil/pixfmt.h) */
const YUVA444P10LE = 91;

type LibAV = any; // libav.js ships its own types; the surface used here is small

export type ProresEncoder = {
  /** a straight-alpha RGBA frame, row 0 at the top — only its alpha is read */
  write(rgba: Uint8ClampedArray): Promise<void>;
  finish(): Promise<Blob>;
  close(): void;
};

/** BT.709, limited range, 10-bit — the text colour, constant across the frame */
function ycbcr709([r, g, b]: RGB) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    Math.round(64 + 876 * y),
    Math.round(512 + 896 * ((b - y) / 1.8556)),
    Math.round(512 + 896 * ((r - y) / 1.5748)),
  ];
}

export async function createProresEncoder(
  width: number,
  height: number,
  fps: number,
  text: RGB,
): Promise<ProresEncoder> {
  const mod = await import(/* @vite-ignore */ FRONTEND);
  const libav: LibAV = await (mod.default ?? mod).LibAV({ base: BASE, nothreads: true });

  let c = 0, frame = 0, pkt = 0, oc = 0, pb = 0;
  try {
    [, c, frame, pkt] = await libav.ff_init_encoder('prores_ks', {
      ctx: { pix_fmt: YUVA444P10LE, width, height, framerate_num: fps, framerate_den: 1 },
      time_base: [1, fps],
      options: {
        profile: '4444',
        alpha_bits: '16',
        vendor: 'apl0',
        // what ffmpeg's CLI writes: a `fiel` atom (progressive) and `colr` (the
        // BT.709 the planes are converted with) — Apple's apps expect both
        field_order: 'progressive',
        color_primaries: 'bt709',
        color_trc: 'bt709',
        colorspace: 'bt709',
        color_range: 'tv',
      },
    });
    [oc, , pb] = await libav.ff_init_muxer({ format_name: 'mov', filename: 'out.mov', open: true }, [[c, 1, fps]]);
    await libav.avformat_write_header(oc, 0);
  } catch (err) {
    libav.terminate();
    throw err;
  }

  // Y, Cb, Cr, A planes of 16-bit little-endian samples
  const n = width * height;
  const data = new Uint8Array(n * 2 * 4);
  const s = new Uint16Array(data.buffer);
  const [y, cb, cr] = ycbcr709(text);
  s.fill(y, 0, n);
  s.fill(cb, n, 2 * n);
  s.fill(cr, 2 * n, 3 * n);
  const layout = [0, 1, 2, 3].map((p) => ({ offset: p * n * 2, stride: width * 2 }));
  let pts = 0;

  return {
    async write(rgba) {
      for (let i = 0; i < n; i++) s[3 * n + i] = (rgba[i * 4 + 3] * 1023 + 127) / 255;
      const packets = await libav.ff_encode_multi(c, frame, pkt, [
        { data, layout, format: YUVA444P10LE, width, height, pts: pts++, ptshi: 0, time_base_num: 1, time_base_den: fps },
      ]);
      // one frame each, or the last frame has no length and the clip reads as 33 fps
      for (const p of packets) Object.assign(p, { duration: 1, durationhi: 0 });
      await libav.ff_write_multi(oc, pkt, packets);
    },
    async finish() {
      await libav.ff_write_multi(oc, pkt, await libav.ff_encode_multi(c, frame, pkt, [], true));
      await libav.av_write_trailer(oc);
      await libav.ff_free_muxer(oc, pb);
      await libav.ff_free_encoder(c, frame, pkt);
      const out: Uint8Array = await libav.readFile('out.mov');
      return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'video/quicktime' });
    },
    close() {
      libav.terminate();
    },
  };
}
