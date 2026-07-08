// The Movie — scroll-scrubbed 9-beat film. See MOVIE.md for the full design.
// One canvas, one rAF. Scroll scrubs a timeline p ∈ [0,1]; everything on
// screen is a pure function of p (plus a clock for ambient motion). A lone
// figure walks away from camera along a winding path, through mist, between
// two hostile crowds, up a hill into the sunrise — where the gathered crowd,
// seen from above, spells WE THE PEOPLE.

type RGB = [number, number, number];

// Palette (silhouette film: figures read dark against graded sky)
const FIG_INK = hex('#0a1721'); // silhouette body
const FIG_WARM = hex('#7a4b32'); // sunrise-lit tint, blended in by warmth
const PATH_PALE = hex('#8fa5a3'); // the pale ribbon of the path
const PAPER = hex('#f6f4ee');
const AERIAL_GREEN = hex('#2e7d51'); // sunlit hilltop for the final shot

// Grade keyframes — sky/fog/light over the whole film, lerped by p.
type Grade = {
  p: number;
  top: RGB; // sky at zenith
  hor: RGB; // sky at horizon (also the fog colour)
  ground: RGB;
  fog: number; // 0..1 mist density
  sunAlt: number; // -1 (buried) .. ~0.5 (risen)
  glow: number; // pre-dawn glow strength
  warmth: number; // how sunrise-lit the figures are
};
const GRADES: Grade[] = [
  { p: 0.0, top: hex('#050d18'), hor: hex('#13283c'), ground: hex('#081411'), fog: 1.0, sunAlt: -1.0, glow: 0.0, warmth: 0 },
  { p: 0.3, top: hex('#071426'), hor: hex('#1b3550'), ground: hex('#0a1a15'), fog: 0.95, sunAlt: -1.0, glow: 0.05, warmth: 0 },
  { p: 0.52, top: hex('#0c2135'), hor: hex('#3d4d66'), ground: hex('#0d221a'), fog: 0.75, sunAlt: -0.6, glow: 0.15, warmth: 0.05 },
  { p: 0.68, top: hex('#1d3a55'), hor: hex('#8a6a58'), ground: hex('#123227'), fog: 0.5, sunAlt: -0.25, glow: 0.4, warmth: 0.2 },
  { p: 0.8, top: hex('#33597a'), hor: hex('#e8a54e'), ground: hex('#1a4433'), fog: 0.25, sunAlt: 0.08, glow: 0.8, warmth: 0.6 },
  { p: 0.9, top: hex('#6fa3c4'), hor: hex('#f6d98a'), ground: hex('#23573f'), fog: 0.08, sunAlt: 0.32, glow: 1.0, warmth: 1 },
  { p: 1.0, top: hex('#8fbcd8'), hor: hex('#f2c14e'), ground: hex('#2a6b4b'), fog: 0.0, sunAlt: 0.5, glow: 1.0, warmth: 1 },
];

// The WORDS — beat bands over p (see MOVIE.md). Beat 1 is the title card,
// beats 8–9 are wordless; the image speaks, then the CTA lands.
const CAPTIONS = [
  { text: 'So many of us feel isolated, powerless, disillusioned', in: 0.06, out: 0.17 },
  { text: 'We can feel more divided than ever', in: 0.17, out: 0.3 },
  { text: 'But there is another way', in: 0.3, out: 0.42 },
  { text: 'A way to heal our divisions', in: 0.42, out: 0.52 },
  { text: 'To reclaim our power', in: 0.52, out: 0.66 },
  { text: 'To make us believe in “us” again', in: 0.66, out: 0.78 },
];

// World layout (z = distance along the journey)
const PATH_LEN = 3800; // playerZ = p * PATH_LEN
const CAM_BACK = 34; // camera trails the player
const EYE = 7; // camera height above ground
const FIG_H = 5.2; // figure height in world units
const HILL_FOOT = 2000;
const HILL_TOP = 3200;
const HILL_H = 120;
const SUMMIT_Z = 3480; // centre of the gathering / the letters
const LETTER_W = 170; // letters' world footprint
const LETTER_D = 80;
const FAR_VIEW = 3600; // draw distance — the whole hill is visible from the start
const FOG_FAR = 1500; // distance at which fog saturates
const PATH_W = 2.1; // path half-width — narrow, a walking trail not a road

type Fig = {
  x: number; // lateral world offset (absolute)
  z: number;
  gait: number;
  jit: number; // per-figure phase jitter
  scale: number;
  kind: 'rival' | 'walker' | 'summit';
  placard?: boolean;
  letter?: number; // summit: index into letter points
  scatA?: number; // summit: scatter vector (angle, radius)
  scatR?: number;
};

export function startMovie() {
  const canvas = document.getElementById('movie') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.setAttribute('aria-hidden', 'true');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowPower = window.matchMedia('(max-width: 700px)').matches; // mobile: thinner crowds

  // deterministic layout — reload mid-scroll reconstructs the identical frame
  let seed = 20260708;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const range = (a: number, b: number) => a + (b - a) * rnd();

  // --- terrain ------------------------------------------------------------
  // Gently rolling valleys flattening into the broad slope up to the summit.
  const elev = (z: number) => {
    const hill = HILL_H * smooth(clamp((z - HILL_FOOT) / (HILL_TOP - HILL_FOOT), 0, 1));
    const rollOff = 1 - smooth(clamp((z - HILL_FOOT) / 500, 0, 1));
    const roll = (Math.sin(z * 0.0035) * 0.6 + Math.sin(z * 0.0011 + 3) * 0.4) * 7 * rollOff;
    return hill + roll;
  };
  const pathX = (z: number) => 26 * Math.sin(z * 0.0021) + 14 * Math.sin(z * 0.00057 + 2);

  // --- letters ------------------------------------------------------------
  // Raster the wordmark offscreen, sample filled pixels → world points on the
  // summit plateau. From above, the crowd *is* the wordmark.
  let letterPts: { x: number; z: number }[] = [];
  // the Fonts API hashes the family name — pull the real stack off :root
  let fontStack =
    getComputedStyle(document.documentElement).getPropertyValue('--font-anton').trim() ||
    'Anton, "Arial Narrow", sans-serif';
  const sampleLetters = () => {
    fontStack =
      getComputedStyle(document.documentElement).getPropertyValue('--font-anton').trim() || fontStack;
    const off = document.createElement('canvas');
    off.width = 560;
    off.height = 260;
    const c = off.getContext('2d');
    if (!c) return;
    c.fillStyle = '#000';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `92px ${fontStack}`;
    c.fillText('WE THE', 280, 78);
    c.fillText('PEOPLE', 280, 188);
    const img = c.getImageData(0, 0, 560, 260).data;
    const pts: { x: number; z: number }[] = [];
    const cxL = pathX(SUMMIT_Z); // letters centred where the path arrives
    for (let py = 3; py < 260; py += 7) {
      for (let px = 3; px < 560; px += 7) {
        if (img[(py * 560 + px) * 4 + 3] > 128) {
          pts.push({
            x: cxL + ((px - 280) / 560) * LETTER_W,
            z: SUMMIT_Z + ((py - 130) / 260) * LETTER_D,
          });
        }
      }
    }
    if (pts.length) letterPts = pts;
  };
  sampleLetters();
  // Anton is preloaded but may land after first paint — resample when ready
  document.fonts?.ready.then(sampleLetters);

  // --- figures ------------------------------------------------------------
  const figs: Fig[] = [];
  // Rival crowds (beats 3–5): two blocks flanking the path. Identical
  // treatment on both sides — we never colour-code a "left" and a "right".
  for (const side of [-1, 1]) {
    for (let i = 0; i < (lowPower ? 64 : 110); i++) {
      const z = range(850, 1750);
      figs.push({
        x: pathX(z) + side * range(6, 38),
        z,
        gait: range(0.7, 1.3),
        jit: rnd() * Math.PI * 2,
        scale: range(0.85, 1.15),
        kind: 'rival',
        placard: rnd() < 0.25,
      });
    }
  }
  // Fellow walkers (beats 6–7): converging on the path as the hill climbs
  for (let i = 0; i < (lowPower ? 30 : 46); i++) {
    const z = range(2050, 3150);
    const squeeze = 1 - ((z - 2050) / 1100) * 0.7;
    figs.push({
      x: pathX(z) + (rnd() < 0.5 ? -1 : 1) * range(4, 60) * squeeze,
      z,
      gait: range(0.7, 1.3),
      jit: rnd() * Math.PI * 2,
      scale: range(0.85, 1.15),
      kind: 'walker',
    });
  }
  // Summit gathering (beats 7–9): everyone owns a letter point, scattered
  // around it until the aerial pull-up tightens the formation.
  const N_SUMMIT = lowPower ? 220 : 340;
  for (let i = 0; i < N_SUMMIT; i++) {
    figs.push({
      x: 0,
      z: SUMMIT_Z,
      gait: range(0.7, 1.3),
      jit: rnd() * Math.PI * 2,
      scale: range(0.85, 1.15),
      kind: 'summit',
      letter: i,
      scatA: rnd() * Math.PI * 2,
      scatR: range(4, 85),
    });
  }

  // --- soft blob sprite (mist / breath / glow stamps) -----------------------
  const blob = document.createElement('canvas');
  blob.width = blob.height = 128;
  {
    const c = blob.getContext('2d')!;
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  }

  // --- canvas sizing --------------------------------------------------------
  let cssW = 0;
  let cssH = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  addEventListener('resize', resize);
  resize();

  // --- DOM overlays ---------------------------------------------------------
  const titleCard = document.getElementById('title-card');
  const caption = document.getElementById('caption');
  const hint = document.getElementById('scroll-hint');
  const join = document.getElementById('join');

  // --- timeline ---------------------------------------------------------------
  let p = 0; // smoothed film progress
  let pPrev = 0;
  let clock = 0; // ambient time (frozen under reduced motion)
  let stride = 0; // shared walk-cycle clock, advanced by scroll speed
  const rawP = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? clamp(scrollY / max, 0, 1) : 0;
  };
  p = rawP(); // land mid-scroll (reload) without a swoosh from zero

  // scratch buffers, reused every frame
  type Slice = { z: number; y: number; fog: number };
  const slices: Slice[] = [];
  const vis: Slice[] = []; // visible skyline slices — the path rides only these
  const drawlist: { z: number; fig?: Fig; mist?: number }[] = [];
  const MIST_Z = [500, 1000, 1600, 2300, 3000];

  // --- main loop ---------------------------------------------------------------
  let raf = 0;
  let last = performance.now();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!reduceMotion) clock += dt;

    // scroll → p, critically-damped so flicks glide instead of teleporting
    p += (rawP() - p) * Math.min(1, dt * (reduceMotion ? 20 : 6));
    const vel = (p - pPrev) / Math.max(dt, 1e-4); // in p/s
    pPrev = p;
    const worldSpeed = Math.abs(vel) * PATH_LEN;
    const walking = worldSpeed > 4;
    if (!reduceMotion) stride += dt * Math.min(11, worldSpeed * 0.055);

    const g = grade(p);
    const playerZ = p * PATH_LEN;
    const camZ = playerZ - CAM_BACK;
    const camX = pathX(camZ);
    const camElev = elev(camZ) + EYE;
    const FOCAL = cssH * 0.95;
    const horizonY = cssH * 0.36;
    const cx = cssW / 2;

    // projection: world (x, z) on the terrain → screen
    const proj = (z: number) => FOCAL / (z - camZ);
    const toScreen = (x: number, z: number) => {
      const s = proj(z);
      return { sx: cx + (x - camX) * s, sy: horizonY + (camElev - elev(z)) * s, s };
    };

    // --- ground slices (geometric spacing: dense near, sparse far) ----------
    slices.length = 0;
    const NEAR = 10;
    const N_SLICE = lowPower ? 72 : 96;
    const ratio = Math.pow(FAR_VIEW / NEAR, 1 / (N_SLICE - 1));
    let d = NEAR;
    for (let i = 0; i < N_SLICE; i++, d *= ratio) {
      const z = camZ + d;
      const y = horizonY + ((camElev - elev(z)) * FOCAL) / d;
      // cap below full white-out so the hill stays a shadowy outline in the mist
      const fog = Math.min(0.93, g.fog * clamp(d / FOG_FAR, 0, 1));
      slices.push({ z, y, fog });
    }

    // --- sky ------------------------------------------------------------------
    const sky = ctx!.createLinearGradient(0, 0, 0, horizonY + cssH * 0.08);
    sky.addColorStop(0, rgb(g.top));
    sky.addColorStop(1, rgb(g.hor));
    ctx!.fillStyle = sky;
    ctx!.fillRect(0, 0, cssW, cssH);

    // --- mountains + sun: far ridges, then the sun nestled between ranges ----
    const sunX = cx + (pathX(camZ + FAR_VIEW) - camX) * proj(camZ + FAR_VIEW);
    const sunY = horizonY + cssH * 0.02 - g.sunAlt * cssH * 0.52;
    if (g.glow > 0.01) {
      const r = cssH * (0.25 + 0.45 * g.glow);
      const gy = Math.max(sunY, horizonY - cssH * 0.1);
      ctx!.save();
      ctx!.globalAlpha = 0.55 * g.glow;
      const gl = ctx!.createRadialGradient(sunX, gy, 0, sunX, gy, r);
      gl.addColorStop(0, 'rgba(242,193,78,0.9)');
      gl.addColorStop(1, 'rgba(242,193,78,0)');
      ctx!.fillStyle = gl;
      ctx!.fillRect(sunX - r, gy - r, r * 2, r * 2);
      ctx!.restore();
    }
    ridgeLayer(ctx!, cssW, horizonY, camX * 0.1 + playerZ * 0.012 + 60, cssH * 0.21, cssH * 0.015, mix(g.ground, g.hor, 0.82), 1.1);
    ridgeLayer(ctx!, cssW, horizonY, camX * 0.18 + playerZ * 0.022 + 900, cssH * 0.165, cssH * 0.008, mix(g.ground, g.hor, 0.68), 1.7);
    if (g.sunAlt > -0.35) {
      // the sun — large, low, orange; whitening as it climbs
      const sr = cssH * 0.105;
      const warmupT = clamp(g.sunAlt / 0.5, 0, 1);
      if (g.sunAlt > 0.02) {
        // rays — slow wheel of translucent wedges
        ctx!.save();
        ctx!.translate(sunX, sunY);
        ctx!.rotate(clock * 0.03);
        ctx!.fillStyle = `rgba(246,217,138,${0.05 * g.glow})`;
        for (let k = 0; k < 12; k++) {
          ctx!.rotate(Math.PI / 6);
          ctx!.beginPath();
          ctx!.moveTo(0, 0);
          ctx!.lineTo(cssH * 1.4, -cssH * 0.055);
          ctx!.lineTo(cssH * 1.4, cssH * 0.055);
          ctx!.closePath();
          ctx!.fill();
        }
        ctx!.restore();
      }
      ctx!.fillStyle = rgb(mix([238, 152, 74], [252, 238, 190], warmupT));
      ctx!.beginPath();
      ctx!.arc(sunX, sunY, sr, 0, Math.PI * 2);
      ctx!.fill();
    }
    // mid + near ridges pass in front of the sun
    ridgeLayer(ctx!, cssW, horizonY, camX * 0.3 + playerZ * 0.045 + 2400, cssH * 0.11, cssH * 0.003, mix(g.ground, g.hor, 0.52), 2.6);
    // the hill ahead — dark mound with the pale path winding to its summit.
    // A cinematic cheat: it looms through beats 1–5, then dissolves as the
    // real terrain climb takes over.
    const hillFade = 1 - smooth(clamp((p - 0.4) / 0.18, 0, 1));
    if (hillFade > 0.01) storyHill(ctx!, cssW, cssH, horizonY, p, hillFade, g);
    ridgeLayer(ctx!, cssW, horizonY, camX * 0.45 + playerZ * 0.07 + 5100, cssH * 0.06, 0, mix(g.ground, g.hor, 0.38), 3.9);

    // --- ground: fill each screen row once, nearest slice wins ----------------
    // Collect the visible skyline slices (a farther slice sitting lower than a
    // nearer one is behind a hill — occluded, skipped). The path then rides
    // only these, so it can never show through terrain that should hide it.
    let bottom = cssH;
    vis.length = 0;
    for (let i = 0; i < slices.length && bottom > 0; i++) {
      const sl = slices[i];
      if (sl.y >= bottom) continue;
      ctx!.fillStyle = rgb(mix(g.ground, g.hor, sl.fog));
      ctx!.fillRect(0, sl.y, cssW, bottom - sl.y + 1);
      bottom = sl.y;
      vis.push(sl);
    }

    // --- the path: one continuous pale ribbon over the visible ground only ----
    if (vis.length > 1) {
      const pathCol = (fog: number) => rgb(mix(mix(PATH_PALE, g.ground, 0.45), g.hor, Math.min(fog, 0.8)));
      ctx!.beginPath();
      for (let i = 0; i < vis.length; i++) {
        // left edge, near → far
        const sl = vis[i];
        const ps = toScreen(pathX(sl.z), sl.z);
        const w = PATH_W * ps.s;
        if (i === 0) ctx!.moveTo(ps.sx - w, sl.y);
        else ctx!.lineTo(ps.sx - w, sl.y);
      }
      for (let i = vis.length - 1; i >= 0; i--) {
        // right edge, far → near
        const sl = vis[i];
        const ps = toScreen(pathX(sl.z), sl.z);
        const w = PATH_W * ps.s;
        ctx!.lineTo(ps.sx + w, sl.y);
      }
      ctx!.closePath();
      const grad = ctx!.createLinearGradient(0, vis[0].y, 0, vis[vis.length - 1].y);
      grad.addColorStop(0, pathCol(vis[0].fog));
      grad.addColorStop(1, pathCol(vis[vis.length - 1].fog));
      ctx!.fillStyle = grad;
      ctx!.fill();
    }

    // --- painter list: figures + mist bands, far → near ----------------------
    const scatter = 1 - smooth(clamp((p - 0.66) / 0.26, 0, 1)); // summit gathers
    drawlist.length = 0;
    for (const f of figs) {
      let fx = f.x;
      let fz = f.z;
      if (f.kind === 'walker') fz = f.z + (p - 0.5) * 260; // they advance as you do
      if (f.kind === 'summit') {
        const pt = letterPts[f.letter! % letterPts.length] ?? { x: 0, z: SUMMIT_Z };
        fx = pt.x + Math.cos(f.scatA!) * f.scatR! * scatter;
        fz = pt.z + Math.sin(f.scatA!) * f.scatR! * scatter * 0.8;
      }
      const dz = fz - camZ;
      if (dz < NEAR || dz > FAR_VIEW) continue;
      drawlist.push({ z: dz, fig: f, mist: undefined });
      // stash resolved position on the fig for the draw pass
      (f as any)._fx = fx;
      (f as any)._fz = fz;
    }
    if (g.fog > 0.02) {
      for (const mz of MIST_Z) {
        const dz = mz - camZ;
        if (dz > NEAR && dz < FAR_VIEW) drawlist.push({ z: dz, mist: mz });
      }
    }
    drawlist.sort((a, b) => b.z - a.z);

    for (const it of drawlist) {
      if (it.mist !== undefined) {
        mistBand(ctx!, blob, toScreen(camX, it.mist).sy, cssW, cssH, g.fog, clock, it.mist);
        continue;
      }
      const f = it.fig!;
      const { sx, sy, s } = toScreen((f as any)._fx, (f as any)._fz);
      const hpx = FIG_H * f.scale * s;
      if (hpx < 2.5 || sx < -40 || sx > cssW + 40) continue;
      const fog = Math.min(0.96, g.fog * clamp(it.z / FOG_FAR, 0, 1));
      const fill = mix(mix(FIG_INK, FIG_WARM, g.warmth * (f.kind === 'summit' ? 1 : 0.6)), g.hor, fog);
      // hostility: ramps with the beat band and with the player closing in
      let hostility = 0;
      let figWalking = false;
      let phase = stride * f.gait + f.jit;
      if (f.kind === 'rival') {
        const band = clamp((p - 0.14) / 0.06, 0, 1) * clamp((0.55 - p) / 0.08, 0, 1);
        const prox = clamp(1 - Math.abs(f.z - playerZ) / 380, 0, 1);
        hostility = clamp(band * (0.45 + prox * 0.8), 0, 1);
        phase = clock * 3 * f.gait + f.jit;
      } else {
        figWalking = walking && f.kind === 'walker';
        if (f.kind === 'summit') figWalking = walking && scatter > 0.03 && scatter < 0.97;
      }
      const rim = smooth(clamp((g.warmth - 0.3) / 0.7, 0, 1)) * (1 - fog);
      drawFigure(ctx!, sx, sy, hpx / 30, phase, figWalking, hostility, fill, f.placard && hostility > 0.05, rim);
    }

    // --- the player: fixed shot, walking into the frame -----------------------
    {
      const { sx, sy, s } = toScreen(pathX(playerZ), playerZ);
      const scale = (FIG_H * 1.06 * s) / 30;
      const fill = mix(FIG_INK, FIG_WARM, g.warmth * 0.8);
      drawFigure(ctx!, sx, sy, scale, stride, walking, 0, fill, false, smooth(clamp((g.warmth - 0.3) / 0.7, 0, 1)));
      // visible breath in the cold beats, while standing
      if (!reduceMotion && p < 0.28 && !walking) {
        const cyc = (clock % 2.8) / 2.8;
        if (cyc < 0.55) {
          const t = cyc / 0.55;
          ctx!.save();
          ctx!.globalAlpha = 0.22 * (1 - t) * (1 - t);
          const r = scale * (5 + t * 14);
          ctx!.drawImage(blob, sx + scale * 4 + t * scale * 9, sy - scale * 31 - t * scale * 7 - r, r * 2, r * 2);
          ctx!.restore();
        }
      }
    }

    // --- beat 4: accusing hands lean in from the edges of the frame -----------
    const handsBand = smooth(clamp((p - 0.3) / 0.035, 0, 1)) * smooth(clamp((0.43 - p) / 0.035, 0, 1));
    if (handsBand > 0.01) {
      pointingHands(ctx!, cssW, cssH, handsBand, reduceMotion ? 0 : clock, FIG_INK, mix(g.hor, PAPER, 0.4));
    }

    // --- finale: the camera soars — crossfade to the aerial shot --------------
    const ae = smooth(clamp((p - 0.88) / 0.1, 0, 1));
    if (ae > 0.005) {
      ctx!.save();
      ctx!.globalAlpha = ae;
      ctx!.fillStyle = rgb(AERIAL_GREEN);
      ctx!.fillRect(0, 0, cssW, cssH);
      // zoom out as we rise: letters resolve from abstract to unmistakable
      const K = Math.min((cssW * 0.82) / LETTER_W, (cssH * 0.62) / LETTER_D) * (1 / (1 + (1 - ae) * 2.4));
      const acx = cssW / 2;
      const acy = cssH * 0.47;
      // hold the letters back until we're well off the ground — the crowd is
      // still a formless mass at eye level; only from above does it resolve
      // into the solid wordmark.
      ctx!.globalAlpha = ae * smooth(clamp((ae - 0.45) / 0.55, 0, 1));
      ctx!.fillStyle = rgb(PAPER);
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';
      const sf = (LETTER_W * K) / 560; // raster px → screen px (matches sampler)
      ctx!.font = `${92 * sf}px ${fontStack}`;
      ctx!.fillText('WE THE', acx, acy + (78 - 130) * sf);
      ctx!.fillText('PEOPLE', acx, acy + (188 - 130) * sf);
      ctx!.globalAlpha = ae;
      // the summit as a sunlit island in a sea of dissipating mist
      const vig = ctx!.createRadialGradient(acx, acy, cssH * 0.28, acx, acy, cssH * 0.85);
      vig.addColorStop(0, 'rgba(246,244,238,0)');
      vig.addColorStop(1, `rgba(246,244,238,${0.85 * (1 - ae * 0.35)})`);
      ctx!.fillStyle = vig;
      ctx!.fillRect(0, 0, cssW, cssH);
      ctx!.restore();
    }

    overlays(p);
  }

  // --- DOM overlay driver ------------------------------------------------------
  let captionText = '';
  function overlays(p: number) {
    if (titleCard) {
      const op = p < 0.035 ? 1 : clamp(1 - (p - 0.035) / 0.025, 0, 1);
      titleCard.style.opacity = String(op);
      titleCard.style.visibility = op <= 0.001 ? 'hidden' : 'visible';
    }
    if (caption) {
      let active: (typeof CAPTIONS)[number] | null = null;
      for (const c of CAPTIONS) {
        if (p >= c.in && p <= c.out) {
          active = c;
          break;
        }
      }
      if (active) {
        if (captionText !== active.text) {
          captionText = active.text;
          caption.textContent = active.text;
        }
        const fin = clamp((p - active.in) / 0.02, 0, 1);
        const fout = clamp((active.out - p) / 0.025, 0, 1);
        caption.style.opacity = String(Math.min(fin, fout));
      } else {
        caption.style.opacity = '0';
      }
    }
    if (hint && p > 0.012) hint.classList.add('gone');
    if (join) join.classList.toggle('show', p > 0.965);
  }

  // pause the film entirely when the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  });
  raf = requestAnimationFrame(frame);
}

// --- figure ---------------------------------------------------------------
// The procedural walker from walk.ts, rear view, silhouette-filled: 2-segment
// legs, swinging (or raised, hostile) arms, torso + head. `s` ≈ pixelHeight/30.
function drawFigure(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  ph: number,
  moving: boolean,
  hostility: number,
  fill: RGB,
  placard: boolean | undefined,
  rim = 0 // sunrise rim-light on the head, 0..1
) {
  const col = rgb(fill);
  const h = 30 * s;
  const bw = 6.6 * s;
  const headR = 3.9 * s;
  const bob = moving ? Math.abs(Math.sin(ph)) * 1.3 * s : 0;
  const hipY = sy - h * 0.4 - bob;
  const shoulderY = hipY - h * 0.42;

  const stride = moving ? 4.6 * s : 0;
  const lift = moving ? 3 * s : 0;
  const stance = moving ? 0 : 1.7 * s; // feet apart when standing
  const armSwing = moving ? 3.4 * s : 0;
  const armOut = moving ? 0 : 2.6 * s; // hands rest a little off the hips

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, 2.3 * s);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;

  // legs
  const leg = (pp: number, side: number) => {
    const sw = Math.sin(pp);
    const footX = sx + sw * stride + side * stance;
    const footY = sy - Math.max(0, sw) * lift;
    ctx.beginPath();
    ctx.moveTo(sx + side * stance * 0.4, hipY);
    ctx.lineTo((sx + footX) / 2 + s, (hipY + footY) / 2 + 1.2 * s);
    ctx.lineTo(footX, footY);
    ctx.stroke();
  };
  leg(ph, -1);
  leg(ph + Math.PI, 1);

  // arms — raised and jittering when hostile, swinging otherwise
  if (hostility > 0.15) {
    const upY = shoulderY - 11 * s * hostility;
    const jitr = Math.sin(ph * 1.4) * 1.6 * s * hostility;
    ctx.beginPath();
    ctx.moveTo(sx, shoulderY + 2 * s);
    ctx.lineTo(sx - 6.5 * s, upY + jitr);
    ctx.moveTo(sx, shoulderY + 2 * s);
    ctx.lineTo(sx + 6.5 * s, upY - jitr);
    ctx.stroke();
    if (placard) {
      // a blank placard on a stick — no slogans, ever
      ctx.beginPath();
      ctx.moveTo(sx + 6.5 * s, upY - jitr);
      ctx.lineTo(sx + 7 * s, upY - jitr - 9 * s);
      ctx.stroke();
      ctx.fillRect(sx + 2.5 * s, upY - jitr - 17 * s, 9 * s, 8 * s);
    }
  } else {
    const arm = (pp: number, side: number) => {
      const sw = Math.sin(pp);
      const handX = sx + sw * armSwing + side * (bw * 0.5 + armOut);
      ctx.beginPath();
      ctx.moveTo(sx + side * bw * 0.45, shoulderY + s);
      ctx.lineTo((sx + handX) / 2 + side * bw * 0.35, shoulderY + h * 0.22);
      ctx.lineTo(handX, shoulderY + h * 0.4);
      ctx.stroke();
    };
    arm(ph + Math.PI, -1);
    arm(ph, 1);
  }

  // torso + head
  roundRect(ctx, sx - bw / 2, shoulderY, bw, hipY - shoulderY, bw / 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, shoulderY - headR * 0.9, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // faces turned to the light: a warm edge catches the top of the head
  if (rim > 0.05) {
    ctx.save();
    ctx.globalAlpha = rim * 0.85;
    ctx.strokeStyle = 'rgb(246,217,138)';
    ctx.lineWidth = Math.max(1, 1.1 * s);
    ctx.beginPath();
    ctx.arc(sx, shoulderY - headR * 0.9, headR, -Math.PI * 0.88, -Math.PI * 0.12);
    ctx.stroke();
    ctx.restore();
  }
}

// --- scenery helpers --------------------------------------------------------
// One mountain range: a deterministic ridge of layered sines rising above the
// horizon. `off` carries the parallax; `sd` de-correlates the layers.
function ridgeLayer(
  ctx: CanvasRenderingContext2D,
  w: number,
  horizonY: number,
  off: number,
  amp: number,
  lift: number,
  col: RGB,
  sd: number
) {
  ctx.fillStyle = rgb(col);
  ctx.beginPath();
  ctx.moveTo(0, horizonY + 4);
  for (let x = 0; x <= w; x += 12) {
    const t = x + off;
    const r =
      (Math.sin(t * 0.0016 + sd) * 0.55 + Math.sin(t * 0.0043 + sd * 2.3) * 0.3 + Math.sin(t * 0.011 + sd * 4.1) * 0.15 + 1) / 2;
    ctx.lineTo(x, horizonY - lift - r * amp);
  }
  ctx.lineTo(w, horizonY + 4);
  ctx.closePath();
  ctx.fill();
}

// The hill of the storyboard's beat 2: a dark central mound with a pale path
// winding to its summit, growing as the walker approaches.
function storyHill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizonY: number,
  p: number,
  fade: number,
  g: { ground: RGB; hor: RGB }
) {
  const grow = 1 + p * 1.3;
  const hw = w * 0.34 * grow; // half-width
  const hh = h * 0.17 * grow; // height above its base
  const cx = w * 0.5;
  const baseY = horizonY + h * 0.012;
  ctx.save();
  ctx.globalAlpha = fade;
  // mound
  ctx.fillStyle = rgb(mix(g.ground, g.hor, 0.58));
  ctx.beginPath();
  ctx.moveTo(cx - hw, baseY);
  ctx.bezierCurveTo(cx - hw * 0.55, baseY - hh * 0.25, cx - hw * 0.38, baseY - hh, cx, baseY - hh);
  ctx.bezierCurveTo(cx + hw * 0.42, baseY - hh, cx + hw * 0.6, baseY - hh * 0.2, cx + hw, baseY);
  ctx.closePath();
  ctx.fill();
  // the pale path, S-curving up the face to the summit
  ctx.strokeStyle = rgb(mix(PATH_PALE, g.hor, 0.45));
  ctx.lineCap = 'round';
  ctx.beginPath();
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px = cx + Math.sin(t * 4.4 + 0.9) * (1 - t) * hw * 0.34;
    const py = baseY - t * hh * 0.97;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineWidth = Math.max(1.2, hw * 0.012);
  ctx.stroke();
  ctx.restore();
}

// Beat 4's accusing hands: giant silhouette arms jab in from both edges of the
// frame, pointing at the walker — dark shapes with a harsh backlit rim so they
// read against the dark ground. `band` fades the shot in and out.
function pointingHands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  band: number,
  clock: number,
  col: RGB,
  rimCol: RGB
) {
  const arms: { side: number; y: number; len: number; tilt: number }[] = [
    { side: -1, y: 0.52, len: 0.26, tilt: -0.02 },
    { side: -1, y: 0.68, len: 0.34, tilt: -0.06 },
    { side: -1, y: 0.84, len: 0.24, tilt: -0.1 },
    { side: 1, y: 0.58, len: 0.3, tilt: -0.04 },
    { side: 1, y: 0.74, len: 0.24, tilt: -0.08 },
    { side: 1, y: 0.88, len: 0.34, tilt: -0.12 },
  ];
  ctx.save();
  ctx.globalAlpha = band;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  arms.forEach((a, i) => {
    const dir = -a.side; // arms reach inward from their edge
    const slide = -(1 - band) * w * 0.12 * dir; // slide in with the fade
    const jab = Math.sin(clock * 6 + i * 1.7) * h * 0.005 * band;
    const x0 = (a.side < 0 ? 0 : w) + slide;
    const y0 = a.y * h;
    const x1 = x0 + dir * (a.len * w + jab);
    const y1 = y0 + a.tilt * h;
    const sw = h * 0.062; // shoulder half-width
    const ww = h * 0.021; // wrist half-width
    const fr = ww * 2.1; // fist radius
    const finX = x1 + dir * (w * 0.045 + fr);
    const finY = y1 + a.tilt * h * 0.2;

    ctx.fillStyle = rgb(col);
    ctx.beginPath();
    ctx.moveTo(x0, y0 - sw);
    ctx.lineTo(x1, y1 - ww);
    ctx.lineTo(x1, y1 + ww);
    ctx.lineTo(x0, y0 + sw);
    ctx.closePath();
    ctx.fill();
    // fist + pointing finger
    ctx.beginPath();
    ctx.arc(x1, y1, fr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(col);
    ctx.lineWidth = ww * 1.3;
    ctx.beginPath();
    ctx.moveTo(x1 + dir * fr * 0.6, y1);
    ctx.lineTo(finX, finY);
    ctx.stroke();
    // harsh backlight catches the upper edge only
    ctx.strokeStyle = rgb(rimCol);
    ctx.globalAlpha = band * 0.55;
    ctx.lineWidth = h * 0.0045;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - sw);
    ctx.lineTo(x1, y1 - ww);
    ctx.arc(x1, y1, fr, -Math.PI * 0.6, dir > 0 ? -Math.PI * 0.1 : -Math.PI * 0.9, dir < 0);
    ctx.moveTo(x1 + dir * fr * 0.6, y1 - ww * 0.6);
    ctx.lineTo(finX, finY - ww * 0.5);
    ctx.stroke();
    ctx.globalAlpha = band;
  });
  ctx.restore();
}

function mistBand(
  ctx: CanvasRenderingContext2D,
  blob: HTMLCanvasElement,
  y: number,
  w: number,
  h: number,
  fog: number,
  clock: number,
  seed: number
) {
  if (y < -80 || y > h + 80) return;
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const drift = ((clock * (6 + (seed % 7)) + i * 260 + seed) % (w + 480)) - 240;
    const r = 110 + ((seed * 13 + i * 57) % 110);
    ctx.globalAlpha = 0.13 * fog;
    ctx.drawImage(blob, drift - r * 1.6, y - r * 0.3, r * 3.2, r * 0.6); // flat drifts
  }
  ctx.restore();
}

// --- maths / colour -----------------------------------------------------------
function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function smooth(t: number) {
  return t * t * (3 - 2 * t);
}
function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function rgb(c: RGB) {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}
function grade(p: number): Grade {
  let i = 0;
  while (i < GRADES.length - 2 && GRADES[i + 1].p < p) i++;
  const a = GRADES[i];
  const b = GRADES[i + 1];
  const t = clamp((p - a.p) / (b.p - a.p), 0, 1);
  return {
    p,
    top: mix(a.top, b.top, t),
    hor: mix(a.hor, b.hor, t),
    ground: mix(a.ground, b.ground, t),
    fog: a.fog + (b.fog - a.fog) * t,
    sunAlt: a.sunAlt + (b.sunAlt - a.sunAlt) * t,
    glow: a.glow + (b.glow - a.glow) * t,
    warmth: a.warmth + (b.warmth - a.warmth) * t,
  };
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
