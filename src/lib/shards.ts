/**
 * Build-time geometry for the broken-glass design. Imported only from Astro
 * frontmatter — runs once at build, never ships to the client. Seeded PRNG
 * keeps rebuilds byte-stable.
 */

export type ShardSlot = {
  /** position as % of the containing field */
  x: number;
  y: number;
  /** width in px (height derives from it) */
  size: number;
  depth: 'fg' | 'bg';
  mobileHide?: boolean;
};

export type FieldShard = {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: 'fg' | 'bg';
  mobileHide: boolean;
  clip: string;
  img: string;
  rz: number; // resting 2D rotation, deg
  // fg tilt config (all deg) — reveal angle is generated INSIDE the amp range
  // so every face is reachable by mouse and by the touch drift alike
  baseRx: number;
  baseRy: number;
  ampX: number;
  ampY: number;
  revealRx: number;
  revealRy: number;
  win: number;
  // touch-mode Lissajous drift (rad/s, rad)
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  // bg CSS float drift
  driftDur: number;
  driftDelay: number;
};

export type Fragment = {
  clip: string;
  origin: string;
  tx: number; // vw
  ty: number; // vh
  rz: number; // deg
  ry: number; // deg
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Angular glass silhouettes (percent-space, applied via clip-path). */
const POLYGONS = [
  'polygon(50% 0%, 100% 32%, 78% 100%, 6% 74%)',
  'polygon(0% 12%, 84% 0%, 100% 68%, 38% 100%)',
  'polygon(22% 0%, 100% 18%, 72% 92%, 0% 100%, 10% 38%)',
  'polygon(0% 0%, 100% 8%, 88% 82%, 26% 100%)',
  'polygon(38% 0%, 100% 44%, 64% 100%, 0% 78%, 8% 22%)',
  'polygon(0% 30%, 62% 0%, 100% 52%, 54% 100%, 12% 88%)',
  'polygon(14% 0%, 96% 12%, 100% 76%, 40% 100%, 0% 56%)',
  'polygon(0% 18%, 70% 0%, 100% 40%, 82% 100%, 18% 84%)',
];

/** Fill hand-placed slots with seeded shapes, tilt ranges and reveal angles. */
export function makeShards(
  slots: ShardSlot[],
  images: string[],
  seed: number,
): FieldShard[] {
  const rnd = mulberry32(seed);
  const rand = (a: number, b: number) => a + rnd() * (b - a);

  return slots.map((s, i) => {
    const ampX = rand(14, 20);
    const ampY = rand(18, 26);
    const baseRx = rand(-6, 6);
    const baseRy = rand(-10, 10);
    return {
      x: s.x,
      y: s.y,
      w: s.size,
      h: Math.round(s.size * rand(1.05, 1.4)),
      depth: s.depth,
      mobileHide: !!s.mobileHide,
      clip: POLYGONS[Math.floor(rnd() * POLYGONS.length)],
      img: images[i % images.length],
      rz: rand(-24, 24),
      baseRx,
      baseRy,
      ampX,
      ampY,
      revealRx: baseRx + ampX * rand(-0.7, 0.7),
      revealRy: baseRy + ampY * rand(-0.7, 0.7),
      win: rand(10, 15),
      w1: rand(0.9, 1.6),
      w2: rand(0.7, 1.3),
      p1: rand(0, Math.PI * 2),
      p2: rand(0, Math.PI * 2),
      driftDur: rand(14, 26),
      driftDelay: -rand(0, 20),
    };
  });
}

export type IntroShard = {
  /** clip polygon, in % of THIS shard's own box (not the stage) */
  clip: string;
  /** transform-origin, in % of this shard's own box */
  origin: string;
  /** centroid, in % of the stage — the pointer field measures against this */
  cx: number;
  cy: number;
  /** the shard's box: its triangle's bounding box, in % of the stage */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  /** the stage-sized inner wrapper, expressed in % of the shard's own box */
  ox: number;
  oy: number;
  sw: number;
  sh: number;
  tx: number; // vw
  ty: number; // vh
  rz: number; // deg
  rx: number; // deg
  ry: number; // deg
  sc: number; // scale at rest-broken state
  delay: number; // s
};

/**
 * Shatter geometry for the glass intro: jittered grid over the wordmark box,
 * every cell split along a random diagonal into two triangles → a gap-free
 * spray of angular glass. Vertices are pushed ~1.5% out from each triangle's
 * centroid so reassembled edges overlap and no seams show. Scatter deltas push
 * outward from centre, hardest at the rim — "really broken", then it converges.
 *
 * PERFORMANCE — why each shard carries a bounding box.
 * The naive build gives every shard the full stage box (`inset: 0`) and clips it.
 * That makes N compositor layers each the size of the whole wordmark: at hero
 * scale one layer is ~2400×1200 device px ≈ 11 MB, so 40 shards ask the GPU for
 * ~450 MB and re-raster the entire title N times. It is the whole reason the
 * effect stutters.
 *
 * So each shard is emitted with the bounding box of its own triangle (`bx/by/
 * bw/bh`, padded a hair so the clip never touches the overflow edge). The
 * component sizes the shard to that box and puts a stage-sized wrapper inside,
 * offset by `ox/oy` and sized `sw/sh` — all expressed in % of the shard box, so
 * they need no pixel measurements. The content lands on exactly the same pixels
 * as before, but the layer, and the raster, is only the triangle. Total layer
 * area across all shards drops from N× the title to ≈1× the title.
 */
export function shatter(cols: number, rows: number, seed: number): IntroShard[] {
  const rnd = mulberry32(seed);
  const rand = (a: number, b: number) => a + rnd() * (b - a);

  const gx: number[][] = [];
  const gy: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    gx[r] = [];
    gy[r] = [];
    for (let c = 0; c <= cols; c++) {
      let x = (c / cols) * 100;
      let y = (r / rows) * 100;
      if (c > 0 && c < cols) x += rand(-0.38, 0.38) * (100 / cols);
      if (r > 0 && r < rows) y += rand(-0.38, 0.38) * (100 / rows);
      gx[r][c] = x;
      gy[r][c] = y;
    }
  }

  const shards: IntroShard[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl: [number, number] = [gx[r][c], gy[r][c]];
      const tr: [number, number] = [gx[r][c + 1], gy[r][c + 1]];
      const br: [number, number] = [gx[r + 1][c + 1], gy[r + 1][c + 1]];
      const bl: [number, number] = [gx[r + 1][c], gy[r + 1][c]];
      // random diagonal keeps the break from reading as a grid
      const tris: Array<Array<[number, number]>> =
        rnd() < 0.5
          ? [
              [tl, tr, br],
              [tl, br, bl],
            ]
          : [
              [tl, tr, bl],
              [tr, br, bl],
            ];

      for (const pts of tris) {
        const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
        const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;

        // vertices pushed out from the centroid so reassembled edges overlap
        const out = pts.map(
          ([x, y]) => [cx + (x - cx) * 1.015, cy + (y - cy) * 1.015] as [number, number],
        );

        // the shard's own box: the triangle's bounds, padded so the clip edge
        // never lands exactly on the box edge (the box is overflow-clipped)
        const xs = out.map((p) => p[0]);
        const ys = out.map((p) => p[1]);
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        const padX = (x1 - x0) * 0.04 + 0.08;
        const padY = (y1 - y0) * 0.04 + 0.08;
        const bx = x0 - padX;
        const by = y0 - padY;
        const bw = x1 - x0 + padX * 2;
        const bh = y1 - y0 + padY * 2;

        // clip + origin re-expressed against the shard's box instead of the stage
        const clip = `polygon(${out
          .map(([x, y]) => `${(((x - bx) / bw) * 100).toFixed(2)}% ${(((y - by) / bh) * 100).toFixed(2)}%`)
          .join(', ')})`;

        // distance from centre drives how far the piece is thrown
        const dirX = (cx - 50) / 50;
        const dirY = (cy - 50) / 50;
        const throwK = 0.55 + Math.hypot(dirX, dirY) * 0.9;

        shards.push({
          clip,
          origin: `${(((cx - bx) / bw) * 100).toFixed(2)}% ${(((cy - by) / bh) * 100).toFixed(2)}%`,
          cx,
          cy,
          bx,
          by,
          bw,
          bh,
          // the stage, as a box inside this shard: width 100/bw of the shard,
          // shifted back by the shard's own offset
          ox: (-bx / bw) * 100,
          oy: (-by / bh) * 100,
          sw: 10000 / bw,
          sh: 10000 / bh,
          tx: dirX * rand(26, 62) * throwK + rand(-10, 10),
          ty: dirY * rand(18, 48) * throwK + rand(-12, 12),
          rz: rand(-120, 120),
          rx: rand(-70, 70),
          ry: rand(-90, 90),
          sc: rand(0.55, 1.5),
          delay: rand(0, 0.34),
        });
      }
    }
  }
  return shards;
}

/**
 * Jittered-grid tessellation for the assembly sheet: jitter interior grid
 * points, take each cell as a quad → gap-free tiling by construction. Each
 * vertex is pushed ~1% out from the cell centroid so assembled edges overlap
 * a hair, hiding antialiasing seams. Scatter deltas push outward from centre.
 */
export function tessellate(cols: number, rows: number, seed: number): Fragment[] {
  const rnd = mulberry32(seed);
  const rand = (a: number, b: number) => a + rnd() * (b - a);

  const gx: number[][] = [];
  const gy: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    gx[r] = [];
    gy[r] = [];
    for (let c = 0; c <= cols; c++) {
      let x = (c / cols) * 100;
      let y = (r / rows) * 100;
      if (c > 0 && c < cols) x += rand(-0.32, 0.32) * (100 / cols);
      if (r > 0 && r < rows) y += rand(-0.32, 0.32) * (100 / rows);
      gx[r][c] = x;
      gy[r][c] = y;
    }
  }

  const frags: Fragment[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pts: Array<[number, number]> = [
        [gx[r][c], gy[r][c]],
        [gx[r][c + 1], gy[r][c + 1]],
        [gx[r + 1][c + 1], gy[r + 1][c + 1]],
        [gx[r + 1][c], gy[r + 1][c]],
      ];
      const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
      const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
      const clip = `polygon(${pts
        .map(([x, y]) => {
          const ox = cx + (x - cx) * 1.012;
          const oy = cy + (y - cy) * 1.012;
          return `${ox.toFixed(2)}% ${oy.toFixed(2)}%`;
        })
        .join(', ')})`;

      const dirX = (cx - 50) / 50 || rand(-0.5, 0.5);
      const dirY = (cy - 50) / 50 || rand(-0.5, 0.5);
      frags.push({
        clip,
        origin: `${cx.toFixed(2)}% ${cy.toFixed(2)}%`,
        tx: dirX * rand(16, 34) + rand(-6, 6),
        ty: dirY * rand(10, 22) + rand(-8, 8),
        rz: rand(-32, 32),
        ry: rand(-58, 58),
      });
    }
  }
  return frags;
}
