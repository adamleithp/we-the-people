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
