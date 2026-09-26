/**
 * Offline render for the video studio: every frame drawn at its exact time by
 * `GlassRenderer`, encoded to PNG, then packed into the chosen file —
 *
 *  - `mov`: ProRes 4444 with alpha, for editing (Premiere, After Effects, Final
 *    Cut, Resolve). Encoded by FFmpeg 9 via libav.js — see `prores.ts` for why
 *    not ffmpeg.wasm. Frames go straight to the encoder, no PNGs.
 *  - `mp4`: H.264 on a solid background, ready to upload as-is.
 *  - `zip`: the PNG sequence with alpha, for anything that won't read the .mov.
 *
 * Everything runs in the visitor's browser; nothing is uploaded. Each encoder is
 * fetched only when a video is actually rendered, and cached after.
 */
import { buildScene, GlassRenderer, type FrameStyle, type SceneOptions } from './glass-renderer';
import { createProresEncoder } from './prores';

export type ExportFormat = 'mov' | 'mp4' | 'zip';

export type ExportSettings = {
  width: number;
  height: number;
  fps: number;
  /** seconds on the finished title */
  hold: number;
  blur: boolean;
  format: ExportFormat;
};

export type Progress = { phase: string; value: number };

const toPng = async (canvas: HTMLCanvasElement, img: ImageData) => {
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not encode a frame.');
  return new Uint8Array(await blob.arrayBuffer());
};

async function loadFfmpeg(onProgress: (p: Progress) => void) {
  onProgress({ phase: 'Loading the video encoder (first time only, ~32 MB)…', value: 0 });
  const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/core?url'),
    import('@ffmpeg/core/wasm?url'),
  ]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
}

export async function renderToFile(
  scene: SceneOptions,
  style: FrameStyle,
  settings: ExportSettings,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const { width, height, fps, format } = settings;
  const abort = () => {
    if (signal.aborted) throw new DOMException('Render cancelled', 'AbortError');
  };

  if (format === 'mov') return renderMov(scene, style, settings, onProgress, signal, abort);

  const ffmpeg = format === 'mp4' ? await loadFfmpeg(onProgress) : null;
  const stopFfmpeg = () => ffmpeg?.terminate();
  signal.addEventListener('abort', stopFfmpeg);

  const glCanvas = document.createElement('canvas');
  const renderer = new GlassRenderer(glCanvas);
  try {
    abort();
    const built = buildScene(scene, width, height);
    renderer.setScene(built);
    const pngCanvas = document.createElement('canvas');
    pngCanvas.width = width;
    pngCanvas.height = height;

    const frames = Math.ceil((built.land + settings.hold) * fps) + 1;
    const zipFiles: Record<string, Uint8Array> = {};
    const name = (i: number) => `frame_${String(i).padStart(4, '0')}.png`;
    const frameShare = format === 'zip' ? 0.95 : 0.6;
    let landed: Uint8Array | null = null; // once every shard is home, frames repeat

    for (let i = 0; i < frames; i++) {
      abort();
      const t = i / fps;
      let png: Uint8Array | null = landed;
      if (!png) {
        renderer.render(t, style, { samples: settings.blur ? 8 : 1, shutter: 0.5, fps, exportFrame: true });
        png = await toPng(pngCanvas, renderer.read());
        if (t >= built.land) landed = png;
      }
      // writeFile transfers (detaches) the buffer — hand over a copy of the reused frame
      if (ffmpeg) await ffmpeg.writeFile(name(i), png === landed ? png.slice() : png);
      else zipFiles[name(i)] = png;
      onProgress({ phase: `Drawing frame ${i + 1} of ${frames}`, value: ((i + 1) / frames) * frameShare });
      // let the page breathe (progress bar, cancel button)
      if (i % 4 === 3) await new Promise((r) => setTimeout(r));
    }

    if (!ffmpeg) {
      onProgress({ phase: 'Packing the zip…', value: 0.97 });
      const { zipSync } = await import('fflate');
      // PNGs are already compressed — store them
      return new Blob([zipSync(zipFiles, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    }

    const encodeLabel = 'Encoding video';
    ffmpeg.on('log', ({ message }) => {
      const m = /frame=\s*(\d+)/.exec(message);
      if (m)
        onProgress({
          phase: `${encodeLabel}… (frame ${m[1]} of ${frames})`,
          value: frameShare + (Number(m[1]) / frames) * (1 - frameShare),
        });
    });
    onProgress({ phase: `${encodeLabel}…`, value: frameShare });
    const code = await ffmpeg.exec([
      '-framerate', String(fps), '-i', 'frame_%04d.png',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      'out.mp4',
    ]);
    abort();
    if (code !== 0) throw new Error('The video encoder failed.');
    const data = (await ffmpeg.readFile('out.mp4')) as Uint8Array<ArrayBuffer>;
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', stopFfmpeg);
    stopFfmpeg();
    renderer.dispose();
  }
}

/** ProRes 4444: draw each frame and hand its alpha straight to the encoder. */
async function renderMov(
  scene: SceneOptions,
  style: FrameStyle,
  settings: ExportSettings,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
  abort: () => void,
): Promise<Blob> {
  const { width, height, fps } = settings;
  onProgress({ phase: 'Loading the video encoder (first time only)…', value: 0 });
  const encoder = await createProresEncoder(width, height, fps, style.text);
  signal.addEventListener('abort', encoder.close);
  const renderer = new GlassRenderer(document.createElement('canvas'));
  try {
    abort();
    const built = buildScene(scene, width, height);
    renderer.setScene(built);
    const frames = Math.ceil((built.land + settings.hold) * fps) + 1;
    let landed: Uint8ClampedArray | null = null; // once every shard is home, frames repeat
    for (let i = 0; i < frames; i++) {
      abort();
      const t = i / fps;
      let rgba: Uint8ClampedArray | null = landed;
      if (!rgba) {
        // alpha only: the encoder applies the text colour itself
        renderer.render(t, { ...style, background: null }, { samples: settings.blur ? 8 : 1, shutter: 0.5, fps, exportFrame: true });
        rgba = renderer.read().data;
        if (t >= built.land) landed = rgba;
      }
      await encoder.write(rgba);
      onProgress({ phase: `Drawing and encoding frame ${i + 1} of ${frames}`, value: ((i + 1) / frames) * 0.97 });
    }
    onProgress({ phase: 'Finishing the file…', value: 0.98 });
    const blob = await encoder.finish();
    abort();
    return blob;
  } finally {
    signal.removeEventListener('abort', encoder.close);
    encoder.close();
    renderer.dispose();
  }
}
