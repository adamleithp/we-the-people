// Draws the UK as topographic contour lines: src/assets/britain-topo.svg.
//
//   npm i --no-save d3-geo d3-contour topojson-client
//   node scripts/build-britain-map.mjs
//
// The coastline is Natural Earth 1:10m (via world-atlas). The "terrain" is a
// stylised height field: distance inland from the coast, plus bumps on the real
// upland areas (Highlands, Snowdonia, the Lakes, …), plus a little noise so the
// rings read as hills rather than an offset coastline. It is not survey data.
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { geoTransverseMercator, geoPath, geoIdentity } from 'd3-geo';
import { contours } from 'd3-contour';
import { feature } from 'topojson-client';

const W = 600;
const H = 1000;
const CELL = 2; // px per height-field sample
const STEP = 11; // height between contour lines
const OUT = new URL('../src/assets/britain-topo.svg', import.meta.url);

const atlas = await (
  await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-10m.json')
).json();
const uk = feature(atlas, atlas.objects.countries).features.find((f) => f.id === '826');
// drop Rockall, which would leave the mainland a third of the frame
uk.geometry.coordinates = uk.geometry.coordinates.filter(([ring]) => ring.some(([lon]) => lon > -9));

// close to the British National Grid's projection, so Britain stands upright
const projection = geoTransverseMercator().rotate([2, -49]).fitExtent(
  [
    [20, 20],
    [W - 20, H - 20],
  ],
  uk,
);
const coast = geoPath(projection)(uk);

// land mask: let sharp rasterise the coastline
const GW = W / CELL;
const GH = H / CELL;
const { data: mask } = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GW}" height="${GH}" viewBox="0 0 ${W} ${H}"><path d="${coast}" fill="#fff"/></svg>`,
  ),
)
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true });
const land = (i) => mask[i] > 127;

// distance inland (two-pass chamfer, in px)
const dist = new Float32Array(GW * GH);
for (let i = 0; i < dist.length; i++) dist[i] = land(i) ? 1e9 : 0;
const relax = (i, j, d) => {
  if (dist[j] + d < dist[i]) dist[i] = dist[j] + d;
};
for (let y = 0; y < GH; y++)
  for (let x = 0; x < GW; x++) {
    const i = y * GW + x;
    if (x > 0) relax(i, i - 1, CELL);
    if (y > 0) relax(i, i - GW, CELL);
    if (x > 0 && y > 0) relax(i, i - GW - 1, CELL * 1.414);
    if (x < GW - 1 && y > 0) relax(i, i - GW + 1, CELL * 1.414);
  }
for (let y = GH - 1; y >= 0; y--)
  for (let x = GW - 1; x >= 0; x--) {
    const i = y * GW + x;
    if (x < GW - 1) relax(i, i + 1, CELL);
    if (y < GH - 1) relax(i, i + GW, CELL);
    if (x < GW - 1 && y < GH - 1) relax(i, i + GW + 1, CELL * 1.414);
    if (x > 0 && y < GH - 1) relax(i, i + GW - 1, CELL * 1.414);
  }

// uplands: [lon, lat, height, spread in px]
const UPLANDS = [
  [-5.0, 56.8, 70, 55], // Ben Nevis
  [-3.65, 57.07, 60, 50], // Cairngorms
  [-4.9, 57.6, 45, 60], // Northwest Highlands
  [-3.4, 55.4, 30, 45], // Southern Uplands
  [-3.2, 54.45, 40, 28], // the Lakes
  [-2.2, 54.3, 28, 60], // Pennines
  [-1.8, 53.35, 18, 26], // Peak District
  [-3.95, 53.05, 40, 30], // Snowdonia
  [-3.5, 52.0, 26, 45], // Cambrian Mountains, Brecon Beacons
  [-3.9, 50.6, 16, 22], // Dartmoor
  [-5.95, 54.18, 22, 20], // Mournes
  [-6.9, 54.75, 16, 26], // Sperrins
];
const bumps = UPLANDS.map(([lon, lat, h, s]) => {
  const [x, y] = projection([lon, lat]);
  return { x, y, h, s2: 2 * s * s };
});

// value noise, seeded, for organic wobble
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const G = 64;
const lattice = Array.from({ length: G * G }, rand);
const smooth = (t) => t * t * (3 - 2 * t);
const noise = (x, y) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const at = (a, b) => lattice[((b & (G - 1)) * G + (a & (G - 1)))];
  const top = at(xi, yi) * (1 - u) + at(xi + 1, yi) * u;
  const bot = at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u;
  return top * (1 - v) + bot * v;
};
const fbm = (x, y) => noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.1;

const height = new Float32Array(GW * GH);
for (let y = 0; y < GH; y++)
  for (let x = 0; x < GW; x++) {
    const i = y * GW + x;
    if (!land(i)) {
      height[i] = -1;
      continue;
    }
    const px = x * CELL;
    const py = y * CELL;
    // coastal rings flatten out inland, so the uplands do the talking
    let h = 22 * Math.log1p(dist[i] / 10);
    for (const b of bumps) h += b.h * Math.exp(-((px - b.x) ** 2 + (py - b.y) ** 2) / b.s2);
    h += (fbm(px / 60, py / 60) - 0.5) * 24;
    height[i] = h;
  }

const thresholds = [];
for (let t = STEP; t < 200; t += STEP) thresholds.push(t);
const rings = contours().size([GW, GH]).smooth(true).thresholds(thresholds)(height);

const toView = geoPath(geoIdentity().scale(CELL)).digits(1);
// the coast is the real vector line; the inland rings come off the raster
const paths = [
  `<path class="coast" d="${geoPath(projection).digits(1)(uk)}"/>`,
  ...rings.filter((r) => r.coordinates.length).map((r) => `<path class="ring" d="${toView(r)}"/>`),
].join('\n');

await writeFile(
  OUT,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true">\n${paths}\n</svg>\n`,
);
console.log(`wrote ${OUT.pathname}: ${rings.length} levels`);
