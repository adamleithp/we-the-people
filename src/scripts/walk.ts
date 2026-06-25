// Idea 2 — The Walk. Prototype engine: pure canvas, single rAF, 2.5D billboard
// figures, procedural walk cycle. You control one character and walk down
// through the manifesto arc; scenes unfold around you. See DESIGN.md.

const FIG = '#ffffff'; // figures are white, read by their outline + shadow
const INK = '#07291b';
const ANGRY = '#c0392b';
const MUTED = '#9aa39b'; // worn-down / despair tint (reads on white)
const GREEN = '#004225'; // "joined the cause" colour at the circle
const BG = '#ffffff';
const SHADOW = 'rgba(7, 41, 27, 0.13)';

type Figure = {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  phase: number; // walk-cycle phase
  speed: number; // gait speed multiplier
  scale: number;
  angry: number; // 0..1 current
  targetAngry: number; // 0..1 goal
  wanderSeed: number;
  ox: number; // push-away offset from the player
  oy: number;
  slump?: number; // 0..1 despair posture (hunched, bowed, still)
  joined?: number; // 0..1 turned green on entering the circle / the cause
  walking?: boolean; // drives the walk cycle in render
  gathering?: boolean; // converging on the centre at the climax
  ga?: number; // gather angle
  gr?: number; // gather radius
  divide?: boolean; // belongs to the "split into sides" scene
  splitDone?: boolean; // reached its side
  drive?: number; // 0..1 eased march throttle (accelerate from rest)
  tx?: number; // split target
  ty?: number;
};

// A narrative beat owns a world-y band [in,out]. Text fades in over the first
// stretch, holds across the whole scene, fades out before the band ends — so
// legibility tracks the action, not a wall-clock timer. `big` = title card.
type Beat = {
  text: string;
  in: number;
  out: number;
  big?: boolean;
};

export function startWalk() {
  const canvas = document.getElementById('walk') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- world layout -------------------------------------------------------
  const WORLD_W = 1400;
  const WORLD_END = 5200; // arrival
  // Beats cut to the action, with leads + breathing gaps between them.
  const beats: Beat[] = [
    { text: 'We start alone.', in: 60, out: 900, big: true },
    { text: 'The world wears us down.', in: 1000, out: 1750, big: true },
    { text: 'Something stirs us to anger.', in: 1850, out: 2650, big: true },
    { text: 'We split into sides.', in: 2450, out: 3450, big: true },
    { text: 'But there is another way…', in: 3550, out: 3950, big: true },
    { text: 'We the People', in: 4050, out: WORLD_END, big: true },
  ];
  const FADE_IN = 150; // px to ramp a line up
  const FADE_OUT = 200; // px to ramp it back down before the band ends

  // deterministic pseudo-random so layout is stable across reloads
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const range = (a: number, b: number) => a + (b - a) * rnd();

  // --- figures ------------------------------------------------------------
  const npcs: Figure[] = [];
  const mk = (x: number, y: number, angry = 0): Figure => ({
    x,
    y,
    baseX: x,
    baseY: y,
    phase: rnd() * Math.PI * 2,
    speed: range(0.7, 1.3),
    scale: range(0.85, 1.15),
    angry,
    targetAngry: angry,
    wanderSeed: rnd() * 100,
    ox: 0,
    oy: 0,
  });

  const DENSITY = 10; // crowd multiplier — crank for an insane amount of NPCs

  // Zone 1 — isolated singles/pairs, scattered
  for (let i = 0; i < 60 * DENSITY; i++) npcs.push(mk(range(120, WORLD_W - 120), range(120, 800)));
  // Zone 2 — despairing clusters: hunched, worn down, motionless
  for (let c = 0; c < 12 * DENSITY; c++) {
    const cx = range(220, WORLD_W - 220);
    const cy = range(1000, 1700);
    for (let i = 0; i < 4; i++) {
      const f = mk(cx + range(-70, 70), cy + range(-50, 50));
      f.slump = range(0.6, 1);
      npcs.push(f);
    }
  }
  // Zone 3 — agitation, figures that will turn angry near the player
  for (let i = 0; i < 48 * DENSITY; i++) npcs.push(mk(range(150, WORLD_W - 150), range(1900, 2600)));
  // Zone 4 — division: everyone starts near the middle, then splits to a side
  // (some cross over the centre). Angry end up on the left, calm on the right.
  for (let i = 0; i < 72 * DENSITY; i++) {
    const y = range(2800, 3500);
    const startX = WORLD_W / 2 + range(-200, 200);
    const left = i % 2 === 0;
    const f = mk(startX, y, 0);
    f.divide = true;
    f.targetAngry = left ? 1 : 0;
    f.ty = y + range(-40, 40);
    f.tx = left ? range(150, WORLD_W * 0.32) : range(WORLD_W * 0.68, WORLD_W - 150);
    npcs.push(f);
  }
  // Zone 5/6 — the gathering: rings around the centre at the journey's end
  const ringCx = WORLD_W / 2;
  const ringCy = 4700;
  const RING = 78 * DENSITY;
  for (let i = 0; i < RING; i++) {
    const a = rnd() * Math.PI * 2; // random angle — scattered, not in rings
    const r = range(380, 1150); // random distance, well out from the centre
    npcs.push(mk(ringCx + Math.cos(a) * r, ringCy + Math.sin(a) * r * 0.7));
  }
  // still-angry but supported figures inside the fold (scene 8 spirit)
  for (let i = 0; i < 12 * DENSITY; i++)
    npcs.push(mk(ringCx + range(-120, 120), ringCy + range(-80, 80), 0.6));

  // --- player -------------------------------------------------------------
  const player: Figure = mk(WORLD_W / 2, 120);
  player.scale = 1.15;
  player.angry = 0;
  player.targetAngry = 0;

  // --- input --------------------------------------------------------------
  const keys = new Set<string>();
  const press = (e: KeyboardEvent, down: boolean) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      if (down) keys.add(k);
      else keys.delete(k);
      e.preventDefault();
    }
  };
  addEventListener('keydown', (e) => press(e, true));
  addEventListener('keyup', (e) => press(e, false));

  // touch / click-to-walk: head toward the tapped point
  let touchTarget: { x: number; y: number } | null = null;
  const setTouch = (clientX: number, clientY: number) => {
    touchTarget = { x: clientX, y: clientY };
  };
  canvas.addEventListener('pointerdown', (e) => setTouch(e.clientX, e.clientY));
  canvas.addEventListener('pointermove', (e) => {
    if (e.pressure > 0 || e.buttons) setTouch(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', () => (touchTarget = null));

  // --- camera -------------------------------------------------------------
  // Leading room: a fixed downward lead keeps the player in the upper part of
  // the screen with the road ahead open below. X stays near-fixed on centre.
  let camX = player.x;
  let camY = player.y;

  // --- canvas sizing ------------------------------------------------------
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

  // --- dom overlays -------------------------------------------------------
  const caption = document.getElementById('caption');
  const hint = document.getElementById('hint');
  const join = document.getElementById('join');
  let arrived = false;
  const visible: Figure[] = []; // reused each frame for the on-screen draw set
  let angerWave = -200; // x-position of the anger front sweeping across scene 3

  // --- figure drawing -----------------------------------------------------
  function drawFigure(f: Figure, sx: number, sy: number, moving: boolean) {
    const s = f.scale;
    const slump = f.slump ?? 0; // despair: hunched, head bowed, shorter
    const h = 30 * s * (1 - 0.24 * slump);
    const w = 11 * s;
    const headR = 6 * s;
    const hipY = sy - h * 0.42;
    const shoulderY = hipY - h * 0.5;

    const swing = moving ? Math.sin(f.phase) * 4 * s : 0;
    const bob = moving ? Math.abs(Math.sin(f.phase)) * 1.6 * s : 0;
    const lean = f.angry * 3 * s; // angry figures lean forward
    // head bows down + forward when worn; pitches forward when angry
    const headFwd = slump * 4.5 * s + lean * 0.5;
    const headDrop = slump * headR * 1.7;

    // colour: white -> muted (worn down) -> red (anger) -> green (joined)
    let fill = mix(FIG, MUTED, slump);
    fill = mix(fill, ANGRY, f.angry);
    fill = mix(fill, GREEN, f.joined ?? 0);

    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // ground shadow (every figure)
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(sx, sy + 1.5, w * 0.85, 2.7 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    ctx.beginPath();
    ctx.moveTo(sx, hipY - bob);
    ctx.lineTo(sx + swing, sy);
    ctx.moveTo(sx, hipY - bob);
    ctx.lineTo(sx - swing, sy);
    ctx.stroke();

    // anger: a raised arm thrown up from the shoulder
    if (f.angry > 0.15) {
      const dir = f.wanderSeed % 2 < 1 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(sx, shoulderY + 3 * s - bob);
      ctx.lineTo(sx + dir * 7 * s, shoulderY - 13 * s * f.angry - bob);
      ctx.stroke();
    }

    // body (capsule)
    ctx.fillStyle = fill;
    roundRect(ctx, sx - w / 2 + lean * 0.3, shoulderY - bob, w, hipY - shoulderY + headR, w / 2);
    ctx.fill();
    ctx.stroke();

    // head
    ctx.beginPath();
    ctx.arc(sx + lean * 0.5 + headFwd, shoulderY - headR * 0.4 - bob + headDrop, headR, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }

  // --- main loop ----------------------------------------------------------
  let last = performance.now();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // input -> velocity
    let vx = 0;
    let vy = 0;
    if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
    if (keys.has('arrowright') || keys.has('d')) vx += 1;
    if (keys.has('arrowup') || keys.has('w')) vy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) vy += 1;

    if (touchTarget) {
      const tx = touchTarget.x - cssW / 2 + camX;
      const ty = touchTarget.y - cssH / 2 + camY;
      const dx = tx - player.x;
      const dy = ty - player.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        vx += dx / d;
        vy += dy / d;
      }
    }

    const len = Math.hypot(vx, vy);
    const moving = len > 0.01;
    if (moving) {
      vx /= len;
      vy /= len;
      const SPEED = 200;
      player.x += vx * SPEED * dt;
      player.y += vy * SPEED * dt;
      player.x = clamp(player.x, 60, WORLD_W - 60);
      player.y = clamp(player.y, 60, WORLD_END);
      player.phase += dt * 10 * player.speed;
    }

    // camera: fixed downward lead (nose room), X near-fixed on the world centre
    // with only a slight drift so it barely moves horizontally.
    const targetCamX = WORLD_W / 2 + (player.x - WORLD_W / 2) * 0.15;
    const targetCamY = player.y + cssH * 0.26;
    camX += (targetCamX - camX) * Math.min(1, dt * 5);
    camY += (targetCamY - camY) * Math.min(1, dt * 5);

    // distance to the gathering centre drives the climax
    const distC = Math.hypot(player.x - ringCx, player.y - ringCy);
    const gatherOn = distC < 1300; // begin converging early — off-screen, before you see them
    const SPLIT_SPEED = 130; // top march speed (everyone shares it)

    // you turn green as you step into the circle / join the cause
    const inCircle = clamp(1 - distC / 620, 0, 1);
    player.joined = (player.joined ?? 0) + (inCircle - (player.joined ?? 0)) * Math.min(1, dt * 1.6);

    // narrative beats: opacity follows world position, holding across the scene
    if (caption) {
      let active: Beat | null = null;
      for (const b of beats) {
        if (player.y >= b.in && player.y <= b.out) {
          active = b;
          break;
        }
      }
      if (active) {
        if (caption.textContent !== active.text) {
          caption.textContent = active.text;
          caption.classList.toggle('title', !!active.big);
        }
        const fin = clamp((player.y - active.in) / FADE_IN, 0, 1);
        const fout = clamp((active.out - player.y) / FADE_OUT, 0, 1);
        let op = Math.min(fin, fout);
        // the closing title strengthens as the crowd tightens around you
        if (active.big && active.in > 4000) op = Math.max(op, 1 - clamp(distC / 760, 0, 1));
        caption.style.opacity = String(op);
      } else {
        caption.style.opacity = '0';
      }
    }
    if (hint && player.y > 320) hint.classList.add('gone');

    // scene 3: as you enter, an "outside influence" sweeps anger across the
    // crowd from the left edge — figures ignite as the front passes them.
    if (player.y > 1850) angerWave += dt * 650;

    for (const f of npcs) {
      // anger spreads with the sweeping front (not by your proximity)
      if (f.baseY > 1850 && f.baseY < 2650 && f.targetAngry === 0 && f.baseX < angerWave) {
        f.targetAngry = 1;
      }
      f.angry += (f.targetAngry - f.angry) * Math.min(1, dt * 2);

      // division: stand motionless, then ease into the march as the player
      // nears — accelerate from rest rather than snapping to full speed.
      if (f.divide && !f.splitDone) {
        const approach = clamp((player.y - 2350) / 450, 0, 1);
        const target = approach * approach * (3 - 2 * approach); // smoothstep
        const drive = (f.drive = (f.drive ?? 0) + (target - (f.drive ?? 0)) * Math.min(1, dt * 1.5));
        const dx = f.tx! - f.x;
        const dy = f.ty! - f.y;
        const d = Math.hypot(dx, dy);
        const step = SPLIT_SPEED * drive * dt;
        if (step > 0 && d <= step) {
          f.x = f.baseX = f.tx!;
          f.y = f.baseY = f.ty!;
          f.splitDone = true; // settle into normal idle on its side
        } else {
          if (step > 0.01) {
            f.x += (dx / d) * step;
            f.y += (dy / d) * step;
          }
          f.walking = drive > 0.12;
          if (!reduceMotion && f.walking) f.phase += dt * (2 + 6 * drive) * f.speed;
          continue; // motionless (drive≈0) or marching — skip idle/repulsion
        }
      }

      // climax: triggers from far out so figures are already converging long
      // before they scroll into view (no synchronised pop). Each collapses
      // inward along its OWN radius — no cross-scramble.
      if (f.baseY > 3600 && gatherOn && !f.gathering) {
        f.gathering = true;
        f.ga = Math.atan2(f.y - ringCy, f.x - ringCx);
        // walk inward to a fraction of the current distance (keeps a clear core)
        const curR = Math.hypot(f.x - ringCx, (f.y - ringCy) / 0.7);
        f.gr = Math.max(150, curR * range(0.32, 0.55));
      }

      if (f.gathering) {
        const tx = ringCx + Math.cos(f.ga!) * f.gr!;
        const ty = ringCy + Math.sin(f.ga!) * f.gr! * 0.7;
        const dx = tx - f.x;
        const dy = ty - f.y;
        const dd = Math.hypot(dx, dy);
        const mv = Math.min(1, dt * 1.7);
        f.x += dx * mv;
        f.y += dy * mv;
        // joining the cause: turn green as they settle into the circle
        f.joined = (f.joined ?? 0) + (1 - (f.joined ?? 0)) * Math.min(1, dt * 0.9);
        f.walking = dd > 5;
        if (!reduceMotion && f.walking) f.phase += dt * 9 * f.speed;
        continue;
      }

      // despair: too worn down to react — stand hunched and still
      if (f.slump) {
        const sigh = reduceMotion ? 0 : Math.sin(now / 1000 * 0.5 + f.wanderSeed) * 0.8;
        f.x = f.baseX;
        f.y = f.baseY + sigh;
        f.walking = false;
        continue;
      }

      // personal space: back away as the player gets close
      const rdx = f.x - player.x;
      const rdy = f.y - player.y;
      const rd = Math.hypot(rdx, rdy);
      const PUSH = 150;
      let pushing = false;
      if (rd < PUSH && rd > 0.001) {
        const force = 1 - rd / PUSH;
        const sp = 340 * force * dt;
        f.ox += (rdx / rd) * sp;
        f.oy += (rdy / rd) * sp;
        pushing = force > 0.15;
      }
      // relax back home once the player moves off
      const relax = Math.min(1, dt * 1.2);
      f.ox += -f.ox * relax;
      f.oy += -f.oy * relax;

      // idle micro-wander (skipped under reduced motion)
      const t = now / 1000 + f.wanderSeed;
      const wx = reduceMotion ? 0 : Math.sin(t * 0.6) * 3 * (0.4 + f.angry);
      const wy = reduceMotion ? 0 : Math.cos(t * 0.5) * 2;
      f.x = f.baseX + wx + f.ox;
      f.y = f.baseY + wy + f.oy;
      f.walking = pushing || (!reduceMotion && f.angry > 0.05);
      if (!reduceMotion) f.phase += dt * ((pushing ? 6 : 0.6) + f.angry * 4) * f.speed;
    }

    // arrival: logo shows once you stand at the centre of the gathering
    if (!arrived && distC < 80) {
      arrived = true;
      join?.classList.add('show');
    }

    render(moving);
    requestAnimationFrame(frame);
  }

  function render(playerMoving: boolean) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cssW, cssH);

    // faint walking path down the middle
    ctx.fillStyle = 'rgba(7,41,27,0.035)';
    ctx.fillRect(WORLD_W / 2 - 80 - camX + cssW / 2, -camY + cssH / 2, 160, WORLD_END + 400);

    // gathering marker at the centre (the cause)
    const gx = WORLD_W / 2 - camX + cssW / 2;
    const gy = 4700 - camY + cssH / 2;
    ctx.strokeStyle = 'rgba(0,66,37,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gx, gy, 250, 0, Math.PI * 2);
    ctx.stroke();

    // CULL FIRST, then depth-sort only what's on screen (painter's algorithm).
    // At thousands of NPCs only a screenful is visible, so the sort stays cheap
    // and we avoid per-frame allocations by reusing one scratch array.
    player.walking = playerMoving;
    const ox = cssW / 2 - camX;
    const oy = cssH / 2 - camY;
    visible.length = 0;
    for (const f of npcs) {
      const sx = f.x + ox;
      const sy = f.y + oy;
      if (sx < -60 || sx > cssW + 60 || sy < -60 || sy > cssH + 80) continue;
      visible.push(f);
    }
    visible.push(player);
    visible.sort((a, b) => a.y - b.y);

    for (const f of visible) {
      drawFigure(f, f.x + ox, f.y + oy, !!f.walking);
    }
  }

  requestAnimationFrame(frame);
}

// --- helpers --------------------------------------------------------------
function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
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

function mix(a: string, b: string, t: number) {
  const ca = hex(a);
  const cb = hex(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
