/**
 * Client engine for the broken-glass site. One rAF loop drives:
 *  (a) foreground shard tilt — damped toward the mouse (fine pointers) or a
 *      time-based Lissajous drift (coarse pointers), with each shard's hidden
 *      face fading in as its tilt nears the shard's reveal angle;
 *  (b) shard-cluster drift — clusters lag the page slightly as it scrolls;
 *  (c) the assembly scrub — one unitless `--q` (1 scattered → 0 assembled)
 *      written per frame; CSS calc() does the per-fragment interpolation.
 *
 * Zero layout reads in the loop: offsets are cached on init and re-measured by
 * a ResizeObserver on <body>. IntersectionObserver gates work to on-screen
 * regions (and toggles `.is-live`, which alone applies will-change). Under
 * `prefers-reduced-motion` we bail before attaching anything — CSS rests the
 * scene complete (assembly assembled, faces softly visible, no drift).
 */

type FgShard = {
  el: HTMLElement;
  face: HTMLElement;
  glare: HTMLElement | null;
  rx: number;
  ry: number;
  baseRx: number;
  baseRy: number;
  ampX: number;
  ampY: number;
  revealRx: number;
  revealRy: number;
  win: number;
  w1: number;
  w2: number;
  p1: number;
  p2: number;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function initGlass(): void {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const num = (v: string | undefined, fallback = 0) => {
    const n = parseFloat(v ?? '');
    return Number.isFinite(n) ? n : fallback;
  };

  // --- foreground reveal shards -------------------------------------------
  const shards: FgShard[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-shard]')) {
    const face = el.querySelector<HTMLElement>('.shard__face');
    if (!face) continue;
    const d = el.dataset;
    shards.push({
      el,
      face,
      glare: el.querySelector<HTMLElement>('.shard__glare'),
      rx: num(d.baseRx),
      ry: num(d.baseRy),
      baseRx: num(d.baseRx),
      baseRy: num(d.baseRy),
      ampX: num(d.ampX, 16),
      ampY: num(d.ampY, 22),
      revealRx: num(d.revealRx),
      revealRy: num(d.revealRy),
      win: num(d.win, 12),
      w1: num(d.w1, 1.1),
      w2: num(d.w2, 0.9),
      p1: num(d.p1),
      p2: num(d.p2),
    });
  }

  // --- drifting clusters ----------------------------------------------------
  const clusters = Array.from(
    document.querySelectorAll<HTMLElement>('[data-cluster]'),
  ).map((el) => ({ el, factor: num(el.dataset.drift, 0.06), center: 0 }));

  // --- assembly ---------------------------------------------------------------
  const assembly = document.querySelector<HTMLElement>('[data-assembly]');
  const stage = assembly?.querySelector<HTMLElement>('[data-stage]') ?? null;
  let aTop = 0;
  let aSpan = 1;
  let sealed = false;

  const heroAct = document.querySelector<HTMLElement>('[data-hero-act]');

  const measure = () => {
    const y = window.scrollY;
    for (const c of clusters) {
      const r = c.el.getBoundingClientRect();
      // scroll position at which the cluster centre crosses the viewport centre
      c.center = r.top + y + r.height / 2 - window.innerHeight / 2;
    }
    if (assembly && stage) {
      aTop = assembly.getBoundingClientRect().top + y;
      // layout-measured span (not innerHeight) so p stays stable while the
      // mobile URL bar collapses
      aSpan = Math.max(1, assembly.offsetHeight - stage.offsetHeight);
    }
  };
  measure();
  new ResizeObserver(measure).observe(document.body);

  // --- visibility gating -------------------------------------------------------
  const visible = new Set<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
        (e.target as HTMLElement).classList.toggle('is-live', e.isIntersecting);
      }
      if (visible.size) ensure();
    },
    { rootMargin: '12% 0%' },
  );
  if (heroAct) io.observe(heroAct);
  for (const c of clusters) io.observe(c.el);
  if (assembly) io.observe(assembly);

  // --- input ---------------------------------------------------------------------
  let nx = 0;
  let ny = 0;
  if (!coarse) {
    window.addEventListener(
      'pointermove',
      (e) => {
        nx = (e.clientX / window.innerWidth) * 2 - 1;
        ny = (e.clientY / window.innerHeight) * 2 - 1;
        ensure();
      },
      { passive: true },
    );
  }
  window.addEventListener('scroll', () => ensure(), { passive: true });

  // --- the loop ---------------------------------------------------------------
  let raf = 0;
  let last = 0;
  let t = 0;

  const frame = (now: number) => {
    raf = 0;
    const dt = clamp((now - last) / 1000 || 0.016, 0.001, 0.05);
    last = now;
    t += dt;
    const k = 1 - Math.exp(-dt * 5); // damped follow

    if (heroAct && visible.has(heroAct)) {
      for (const s of shards) {
        const targetRx = coarse
          ? s.baseRx + s.ampX * 0.8 * Math.sin(t * s.w1 + s.p1)
          : s.baseRx - ny * s.ampX;
        const targetRy = coarse
          ? s.baseRy + s.ampY * 0.8 * Math.sin(t * s.w2 + s.p2)
          : s.baseRy + nx * s.ampY;
        s.rx += (targetRx - s.rx) * k;
        s.ry += (targetRy - s.ry) * k;

        const d = Math.hypot(s.rx - s.revealRx, s.ry - s.revealRy);
        const o = smooth(clamp(1 - d / s.win, 0, 1));
        s.face.style.opacity = (0.08 + 0.92 * o).toFixed(3);
        if (s.glare) {
          s.glare.style.transform = `translate(${((s.ry / s.ampY) * 18).toFixed(2)}%, ${((s.rx / s.ampX) * -18).toFixed(2)}%) rotate(24deg)`;
        }
        s.el.style.transform = `translateZ(0) rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg)`;
      }
    }

    const y = window.scrollY;
    for (const c of clusters) {
      if (!visible.has(c.el)) continue;
      c.el.style.transform = `translate3d(0, ${((c.center - y) * c.factor).toFixed(1)}px, 0)`;
    }

    if (assembly && stage && visible.has(assembly)) {
      const p = clamp((y - aTop) / aSpan, 0, 1);
      const q = 1 - easeInOutCubic(clamp(p / 0.82, 0, 1));
      stage.style.setProperty('--q', q.toFixed(4));
      const isSealed = p > 0.82;
      if (isSealed !== sealed) {
        sealed = isSealed;
        stage.classList.toggle('is-sealed', sealed);
      }
    }

    if (visible.size) raf = requestAnimationFrame(frame);
  };

  const ensure = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  ensure(); // paint resting states once
}
