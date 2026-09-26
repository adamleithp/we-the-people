/**
 * The glass intro, redrawn in WebGL2 for the video studio (`/studio`).
 *
 * The site animates DOM shards with CSS; a browser can't screenshot its own DOM
 * frame by frame, so the studio replays the same motion on a canvas instead:
 * the same `shatter()` triangles, the same `shard-assemble` keyframes and
 * easing, the same 1200px perspective about the title's centre, in the same
 * paint order. What it adds is what video needs — exact frame times, MSAA edges
 * and shutter motion blur (sub-frames averaged in a half-float buffer).
 *
 * The title is one colour, so the shards only carry coverage (alpha). Colour is
 * applied once at the end, which gives transparent exports a perfectly clean
 * straight-alpha edge: every pixel is the text colour, only alpha varies.
 */
import { shatter } from './shards';
import { INTRO, INTRO_EASE, type IntroVariant } from './intro';

export type RGB = [number, number, number];

export type SceneOptions = {
  /** the title, one entry per line */
  lines: string[];
  variant: IntroVariant;
  seed: number;
  /** resolved CSS font-family list for the wordmark (Anton) */
  fontFamily: string;
  /** cap height of the type as a fraction of the frame's shorter side */
  size: number;
};

type Shard = {
  /** triangle, stage px */
  pts: Array<[number, number]>;
  /** texture coords per vertex */
  uv: Array<[number, number]>;
  /** transform origin (centroid), stage px */
  ox: number;
  oy: number;
  /** thrown-out state: px, px, rad, rad, rad, scale */
  tx: number;
  ty: number;
  rx: number;
  ry: number;
  rz: number;
  sc: number;
  delay: number;
  /** winding of the untransformed triangle — a flip means we see its back */
  wind: number;
};

export type Scene = {
  width: number;
  height: number;
  text: HTMLCanvasElement;
  shards: Shard[];
  stageLeft: number;
  stageTop: number;
  stageW: number;
  stageH: number;
  perspective: number;
  flight: number;
  /** seconds until the last shard lands */
  land: number;
};

const DEG = Math.PI / 180;

/** CSS `cubic-bezier()` as a function of progress. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    // Newton stalled: bisect
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
const ease = cubicBezier(...INTRO_EASE);

/**
 * Lay out the title and the shards for a `width`×`height` frame. Units follow
 * the site at 1080p: a CSS px is `min(width, height) / 1080` frame px, so a 4K
 * render is the 1080p one at twice the resolution.
 */
export function buildScene(opt: SceneOptions, width: number, height: number): Scene {
  const u = Math.min(width, height) / 1080;
  const lines = opt.lines.length ? opt.lines : [' '];

  const measure = document.createElement('canvas').getContext('2d')!;
  const setFont = (ctx: CanvasRenderingContext2D, px: number) => {
    ctx.font = `400 ${px}px ${opt.fontFamily}`;
    // .wtp-wordmark: letter-spacing 0.005em
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.005 * px}px`;
  };

  let fontPx = opt.size * Math.min(width, height);
  setFont(measure, fontPx);
  let widest = Math.max(...lines.map((l) => measure.measureText(l.toUpperCase()).width));
  // never wider than 90% of the frame — long titles shrink rather than crop
  if (widest > width * 0.9) {
    fontPx *= (width * 0.9) / widest;
    setFont(measure, fontPx);
    widest = Math.max(...lines.map((l) => measure.measureText(l.toUpperCase()).width));
  }
  const m = measure.measureText('WTP');
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;

  // the stage is the wordmark's own box: widest line × N lines at 0.84
  const lineH = 0.84 * fontPx;
  const stageW = Math.max(1, widest);
  const stageH = lineH * lines.length;

  // title texture, padded: pushed-out shard edges sample a hair past the box
  const pad = Math.ceil(fontPx * 0.12);
  const text = document.createElement('canvas');
  text.width = Math.ceil(stageW + pad * 2);
  text.height = Math.ceil(stageH + pad * 2);
  const tctx = text.getContext('2d')!;
  setFont(tctx, fontPx);
  tctx.fillStyle = '#fff';
  tctx.textAlign = 'center';
  tctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    // CSS half-leading: the glyph box is centred in its (short) line box
    const y = pad + i * lineH + (lineH - (asc + desc)) / 2 + asc;
    tctx.fillText(l.toUpperCase(), pad + stageW / 2, y);
  });

  const { cols, rows, flight, staggerScale } = INTRO[opt.variant];
  const shards: Shard[] = shatter(cols, rows, opt.seed).map((s) => {
    const pts = s.pts.map(([x, y]) => [(x / 100) * stageW, (y / 100) * stageH] as [number, number]);
    const [a, b, c] = pts;
    return {
      pts,
      uv: pts.map(([x, y]) => [(x + pad) / text.width, (y + pad) / text.height] as [number, number]),
      ox: (s.cx / 100) * stageW,
      oy: (s.cy / 100) * stageH,
      tx: (s.tx / 100) * width, // vw
      ty: (s.ty / 100) * height, // vh
      rx: s.rx * DEG,
      ry: s.ry * DEG,
      rz: s.rz * DEG,
      sc: s.sc,
      delay: s.delay * staggerScale,
      wind: Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])),
    };
  });

  return {
    width,
    height,
    text,
    shards,
    stageLeft: (width - stageW) / 2,
    stageTop: (height - stageH) / 2,
    stageW,
    stageH,
    perspective: 1200 * u,
    flight,
    land: Math.max(...shards.map((s) => s.delay)) + flight,
  };
}

/**
 * Vertices for time `t` (s): per vertex clip-x, clip-y, w, u, v, opacity.
 * `shard-assemble`: 0% hidden & thrown, 10% visible & thrown, 100% `none`,
 * the timing function applied per keyframe interval, as CSS does.
 */
function geometry(scene: Scene, t: number, out: Float32Array): number {
  const { width: W, height: H, perspective: d } = scene;
  const pcx = W / 2;
  const pcy = H / 2;
  let n = 0;
  for (const s of scene.shards) {
    const p = Math.min(1, Math.max(0, (t - s.delay) / scene.flight));
    let alpha = 1;
    let k = 1;
    if (p < 0.1) alpha = ease(p / 0.1);
    else k = 1 - ease((p - 0.1) / 0.9);
    if (alpha <= 0) continue;

    const sc = 1 + (s.sc - 1) * k;
    const cz = Math.cos(s.rz * k), sz = Math.sin(s.rz * k);
    const cy = Math.cos(s.ry * k), sy = Math.sin(s.ry * k);
    const cx = Math.cos(s.rx * k), sx = Math.sin(s.rx * k);

    const proj: number[] = [];
    let ok = true;
    for (const [px, py] of s.pts) {
      // translate3d · rotateX · rotateY · rotateZ · scale, about the centroid
      let x = (px - s.ox) * sc;
      let y = (py - s.oy) * sc;
      let z = 0;
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      x += s.ox + s.tx * k + scene.stageLeft;
      y += s.oy + s.ty * k + scene.stageTop;
      // perspective: 1200px about the stage centre
      const w = 1 - z / d;
      if (w <= 0.05) ok = false;
      proj.push(pcx + (x - pcx) / w, pcy + (y - pcy) / w, w);
    }
    if (!ok) continue;
    // backface-visibility: hidden
    const area =
      (proj[3] - proj[0]) * (proj[7] - proj[1]) - (proj[4] - proj[1]) * (proj[6] - proj[0]);
    if (Math.sign(area) !== s.wind) continue;

    for (let i = 0; i < 3; i++) {
      const w = proj[i * 3 + 2];
      out[n++] = ((proj[i * 3] / W) * 2 - 1) * w;
      out[n++] = (1 - (proj[i * 3 + 1] / H) * 2) * w;
      out[n++] = w;
      out[n++] = s.uv[i][0];
      out[n++] = s.uv[i][1];
      out[n++] = alpha;
    }
  }
  return n / 6;
}

const VS_SHARD = `#version 300 es
in vec3 aPos; in vec2 aUV; in float aAlpha;
out vec2 vUV; out float vAlpha;
void main() {
  vUV = aUV; vAlpha = aAlpha;
  gl_Position = vec4(aPos.xy, 0.0, aPos.z); // w → perspective-correct UVs
}`;
const FS_SHARD = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV; in float vAlpha;
out vec4 o;
void main() { o = vec4(texture(uTex, vUV).a * vAlpha); }`;

const VS_QUAD = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FS_ACCUM = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform float uWeight;
in vec2 vUV; out vec4 o;
void main() { o = texture(uTex, vUV) * uWeight; }`;
const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec3 uText; uniform vec3 uBg;
uniform int uMode; // 0 transparent/premultiplied (screen), 1 transparent/straight (export), 2 opaque
uniform bool uFlip;
in vec2 vUV; out vec4 o;
void main() {
  vec2 uv = uFlip ? vec2(vUV.x, 1.0 - vUV.y) : vUV;
  float a = clamp(texture(uTex, uv).a, 0.0, 1.0);
  if (uMode == 2) o = vec4(mix(uBg, uText, a), 1.0);
  else if (uMode == 1) o = vec4(uText, a);
  else o = vec4(uText * a, a);
}`;

export type FrameStyle = {
  text: RGB;
  /** null = transparent */
  background: RGB | null;
};

export class GlassRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private scene: Scene | null = null;
  private progShard: WebGLProgram;
  private progAccum: WebGLProgram;
  private progFinal: WebGLProgram;
  private vbo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private quadVao: WebGLVertexArrayObject;
  private verts = new Float32Array(0);
  private tex: WebGLTexture;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaRb: WebGLRenderbuffer | null = null;
  private resolveFbo: WebGLFramebuffer | null = null;
  private resolveTex: WebGLTexture | null = null;
  private accumFbo: WebGLFramebuffer | null = null;
  private accumTex: WebGLTexture | null = null;
  private outFbo: WebGLFramebuffer | null = null;
  private outTex: WebGLTexture | null = null;
  private size = [0, 0];
  /** half-float accumulation available → motion blur */
  readonly canBlur: boolean;
  private msaa: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canBlur = !!gl.getExtension('EXT_color_buffer_float');
    this.msaa = Math.min(8, gl.getParameter(gl.MAX_SAMPLES) as number);

    this.progShard = this.program(VS_SHARD, FS_SHARD);
    this.progAccum = this.program(VS_QUAD, FS_ACCUM);
    this.progFinal = this.program(VS_QUAD, FS_FINAL);

    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.progShard, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, offset);
    };
    attr('aPos', 3, 0);
    attr('aUV', 2, 12);
    attr('aAlpha', 1, 20);
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);

    this.tex = gl.createTexture()!;
  }

  private program(vs: string, fs: string) {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private target(internal: number, w: number, h: number) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  private resize(w: number, h: number) {
    if (this.size[0] === w && this.size[1] === h) return;
    const gl = this.gl;
    for (const f of [this.msaaFbo, this.resolveFbo, this.accumFbo, this.outFbo]) if (f) gl.deleteFramebuffer(f);
    for (const t of [this.resolveTex, this.accumTex, this.outTex]) if (t) gl.deleteTexture(t);
    if (this.msaaRb) gl.deleteRenderbuffer(this.msaaRb);

    this.canvas.width = w;
    this.canvas.height = h;
    this.msaaRb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaa, gl.RGBA8, w, h);
    this.msaaFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaRb);

    ({ tex: this.resolveTex, fbo: this.resolveFbo } = this.target(gl.RGBA8, w, h));
    if (this.canBlur) ({ tex: this.accumTex, fbo: this.accumFbo } = this.target(gl.RGBA16F, w, h));
    ({ tex: this.outTex, fbo: this.outFbo } = this.target(gl.RGBA8, w, h));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.size = [w, h];
  }

  setScene(scene: Scene) {
    const gl = this.gl;
    this.scene = scene;
    this.resize(scene.width, scene.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene.text);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const need = scene.shards.length * 3 * 6;
    if (this.verts.length < need) this.verts = new Float32Array(need);
  }

  /** draw the shards at `t` into the MSAA buffer and resolve it */
  private drawShards(t: number) {
    const gl = this.gl;
    const scene = this.scene!;
    const count = geometry(scene, t, this.verts);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
    gl.viewport(0, 0, scene.width, scene.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count) {
      gl.useProgram(this.progShard);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, count * 6), gl.STREAM_DRAW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(gl.getUniformLocation(this.progShard, 'uTex'), 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied "over", DOM order
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.blitFramebuffer(0, 0, scene.width, scene.height, 0, 0, scene.width, scene.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }

  /**
   * Render the frame at `t` seconds. With `samples` > 1 the shutter stays open
   * for `shutter` of a frame at `fps` and the sub-frames are averaged.
   * `exportFrame` draws into an offscreen straight-alpha buffer for `readPixels`.
   */
  render(
    t: number,
    style: FrameStyle,
    { samples = 1, shutter = 0.5, fps = 30, exportFrame = false } = {},
  ) {
    const gl = this.gl;
    const scene = this.scene;
    if (!scene) return;
    const n = this.canBlur ? Math.max(1, samples) : 1;

    let src = this.resolveTex;
    if (n === 1) {
      this.drawShards(t);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (let i = 0; i < n; i++) {
        this.drawShards(t + ((i / n) * shutter) / fps);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo);
        gl.viewport(0, 0, scene.width, scene.height);
        gl.useProgram(this.progAccum);
        gl.bindVertexArray(this.quadVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.resolveTex);
        gl.uniform1i(gl.getUniformLocation(this.progAccum, 'uTex'), 0);
        gl.uniform1f(gl.getUniformLocation(this.progAccum, 'uWeight'), 1 / n);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      src = this.accumTex;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, exportFrame ? this.outFbo : null);
    gl.viewport(0, 0, scene.width, scene.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progFinal);
    gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    const loc = (k: string) => gl.getUniformLocation(this.progFinal, k);
    gl.uniform1i(loc('uTex'), 0);
    gl.uniform3fv(loc('uText'), style.text);
    gl.uniform3fv(loc('uBg'), style.background ?? [0, 0, 0]);
    gl.uniform1i(loc('uMode'), style.background ? 2 : exportFrame ? 1 : 0);
    // readPixels reads bottom-up; flip so row 0 is the top of the picture
    gl.uniform1i(loc('uFlip'), exportFrame ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** the last `exportFrame` render, top row first, straight RGBA */
  read(): ImageData {
    const gl = this.gl;
    const [w, h] = this.size;
    const px = new Uint8ClampedArray(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new ImageData(px, w, h);
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
