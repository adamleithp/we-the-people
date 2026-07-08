# The Movie — build design (v2 homepage)

How the 9-beat storyboard becomes the homepage. This is the build source of truth
for `src/scripts/movie.ts`; the storyboard itself (beats, copy, imagery) lives at
the bottom of this file. Concept/brand ground truth stays in `OVERVIEW.md`.

## What it is

A scroll-scrubbed short film rendered on one full-screen canvas. The page is a
tall scroll track (`index.astro`, ~900vh); scrolling scrubs the timeline. As you
scroll, a lone figure walks away from camera along a path toward a hill, through
mist, past two hostile crowds, up the hill into a sunrise, joining a gathering
that — seen from above in the final shot — spells **WE THE PEOPLE**. The film
ends on the Join Us CTA: the journey *is* the sign-up funnel.

### Decisions (and why)

- **Scroll-driven, not WASD walking.** Audience is literally everyone,
  mobile-first; scroll is the one gesture everyone has. Scrolling *is* the
  walking — scroll velocity drives the player's walk cycle, so agency still
  reads as "I am walking them up the hill". Keyboard (arrows/space/PgDn)
  works for free via native document scroll. The WASD prototype survives as
  `walk.ts` (idea 2) and can be remounted at `/walk`.
- **Full 9 beats in this pass, minimal graphics.** Silhouettes, gradients,
  procedural shapes only — no image assets. Nail the whole arc end-to-end,
  then upgrade art per scene.
- **Camera behind the figure, walking into the frame** (pseudo-3D ground
  plane), lifting to an aerial top-down for the finale. Matches the
  storyboard's "path between two crowds" and "letters from above" shots,
  which a top-down or side-scroll view can't do.
- **Canvas 2D, no WebGL, no libraries.** Same reasoning as `DESIGN.md`:
  hundreds of billboard figures on a fake ground plane is trivial for canvas;
  a full 3D scene buys nothing at silhouette fidelity.
- **Both rival crowds get identical visual treatment** (same dark hostile
  silhouettes, same tint). We never colour-code a "left" and a "right" side —
  non-partisan is a brand invariant.

## Architecture

```
index.astro          fixed <canvas id="movie"> + DOM overlays + 900vh .track
  └── movie.ts       the whole engine, one rAF loop
        timeline     scrollY → progress p ∈ [0,1] (smoothed) → beat state
        grade        sky/fog/light keyframes lerped by p
        world        terrain layers, path, sun, mist
        figures      player + NPC crowds (reused procedural figure)
        camera       behind-figure projection → aerial blend for finale
        overlays     #title-card, #caption, #join opacity driven by p
```

`walk.ts` is untouched (kept as the idea-2 prototype). Helpers worth lifting
from it into `movie.ts`: the articulated figure drawing + walk cycle, the
deterministic PRNG (`seed`/`rnd`/`range`), `mix`/`hex`/`clamp`, DPR-capped
canvas sizing, cull-then-depth-sort rendering.

### 1. Timeline (scroll → film)

- `p = scrollY / (trackHeight − viewportHeight)`, clamped 0..1.
- Smooth with a critically-damped ease toward the raw target (`p += (raw − p) ·
  min(1, dt·k)`) so flick-scrolls glide instead of teleporting.
- `scrollVel = dp/dt` drives the player's walk-cycle speed and stride; at rest
  the figure stands, breath visible (see beat 2).
- Everything downstream is a pure function of `p` (plus a clock for ambient
  motion: mist drift, breathing, flag flutter). Deterministic PRNG for layout →
  reloading mid-scroll reconstructs the identical frame.

Beat bands (tunable; fades ~0.02p in / 0.03p out, gaps are the breath):

| # | p band       | Copy (DOM caption)                                   | Scene state |
|---|--------------|------------------------------------------------------|-------------|
| 1 | 0.00 – 0.06  | WHERE CAN WE FIND OUR HOPE? (white title card)       | Card over everything, fades up on scene |
| 2 | 0.06 – 0.17  | SO MANY OF US FEEL ISOLATED, POWERLESS, DISILLUSIONED | Lone figure, pre-dawn, mist, hill + path ahead |
| 3 | 0.17 – 0.30  | WE CAN FEEL MORE DIVIDED THAN EVER                   | Rival crowds materialise flanking the path |
| 4 | 0.30 – 0.42  | BUT THERE IS ANOTHER WAY                             | Walking the centre line between them |
| 5 | 0.42 – 0.52  | A WAY TO HEAL OUR DIVISIONS                          | Crowds recede into mist behind; quiet |
| 6 | 0.52 – 0.66  | TO RECLAIM OUR POWER                                 | Climbing; sky warming; fellow walkers appear |
| 7 | 0.66 – 0.78  | TO MAKE US BELIEVE IN "US" AGAIN                     | Summit crowd ahead, walkers converging |
| 8 | 0.78 – 0.88  | *(no copy — the image speaks)*                       | Sun breaks horizon, rays, mist burns off |
| 9 | 0.88 – 1.00  | *(aerial)* → Join Us CTA                             | Camera lifts; crowd resolves into WE THE PEOPLE |

### 2. Projection — pseudo-3D ground plane

World space: `x` lateral, `z` distance ahead of camera, flat ground until the
hill. Standard perspective-on-a-plane:

```
scale = FOCAL / (z − camZ)              // z clamped past near plane
sx    = cx + (x − camX) · scale
sy    = horizonY + camHeight · scale    // ground line for that depth
```

- Figures are billboards: draw at `(sx, sy)` scaled by `scale`. Existing
  procedural figure works as a rear view (no face; arms/legs read fine).
- The hill = the ground line rising: `groundY(z)` is flat then ramps; `sy`
  uses the terrain height, so the path and figures climb visibly.
- Depth fog: each figure/terrain layer colour is `mix(colour, skyAtHorizon,
  fog(z))` — distant crowds become the storyboard's "jagged silhouettes in
  mist" for free.
- Painter's algorithm: cull to visible z-range, sort far→near, draw.

**Finale camera lift (beat 9):** one blend parameter `aerial ∈ 0..1` lerps the
projection from behind-view to straight-down orthographic (screen pos →
`lerp(perspective(pt), topDown(pt), aerial)`). During the lift the summit crowd
eases from gathered-blob positions to letter-formation targets.

**Letter targets:** at init, raster "WE THE PEOPLE" (wordmark font, 3 lines) to
an offscreen canvas, sample filled pixels on a grid → N world-space points on
the summit plateau. Each summit figure gets the nearest free point
(greedy assignment). From above, the crowd *is* the wordmark.

### 3. Grade — sky, light, mist

A keyframe table over `p`, each entry `{ p, skyTop, skyHorizon, ground, fogColour,
fogDensity, sunAltitude, sunGlow }`, lerped between entries:

- 0.0–0.4: cold dark blue (`#0a1522` → deep slate), heavy fog, no sun.
- 0.4–0.7: blue warms toward violet/amber at the horizon, fog thinning.
- 0.7–0.9: sunrise — sun disc crests `groundY` at the summit, dawn-yellow
  (`--color-wtp-dawn #f2c14e`) glow, radial rays (few wide translucent wedges
  rotating slowly), fog density → 0.
- 0.9–1.0: full daylight, green hilltop (`--color-wtp-green` family) for the
  aerial shot — letters read paper-on-green like the brand lockup.

Mist: 3–4 horizontal translucent gradient bands at fixed depths, drifting
laterally on the clock, alpha × `fogDensity(p)`. Cheap, layered, and its
disappearance at sunrise is the emotional turn.

### 4. Figures & crowds

One `Figure` type (port of `walk.ts`): world `x/z`, walk phase, scale jitter,
`hostility 0..1` (raised jittering arms, leaning posture), `warmth 0..1`
(silhouette-black → warm-lit at sunrise). All laid out deterministically at
init; behaviour is keyed off `p` and player distance.

- **Player**: fixed screen position (bottom-centre third), world `z` advances
  with `p` along the path spline `pathX(z)`. Walk cycle speed ∝ scroll
  velocity. Idle: subtle breathing + a faint breath-vapour puff (two or three
  fading translucent ellipses) while in the cold beats only.
- **Rival crowds (beats 3–5)**: two blocks flanking the path over a z-band,
  facing each other. Hostility ramps as the player approaches, decays after
  passing. A few placard rectangles held overhead (blank — no slogans). Both
  sides identical treatment. They *materialise from the mist*: alpha tied to
  fog + beat, not a pop-in.
- **Fellow walkers (beats 6–7)**: figures ahead/flanking on converging
  headings toward the summit, same walk direction as the player, spacing
  tightening with `p`.
- **Summit crowd (beats 7–9)**: pre-assigned letter targets; until the lift
  they stand gathered (targets + gaussian scatter, scatter → 0 as `aerial`
  rises). Faces turn to the sun in beat 8: warmth tween.

Counts: aim ~300–600 total, culled per frame. Mobile gets a reduced multiplier.

### 5. DOM overlays (already in `index.astro`)

- `#title-card` — beat 1 white card, opacity `1 → 0` across its band.
- `#caption` — the WORDS, one line at a time, fade in/hold/fade out per band
  (same logic as `walk.ts` beats, driven by `p` instead of world-y).
- `#scroll-hint` — visible until first meaningful scroll (`p > 0.01`).
- `#join` — "Be part of hope. / Join Us" shown at `p > ~0.97`, once the
  letters have resolved. Primary CTA of the whole site.

### 6. Accessibility & performance

- **`prefers-reduced-motion`**: no walk cycles, no mist drift, no ray
  rotation; scrubbing still moves through the scenes as near-static tableaux
  with cross-fades. Copy remains fully readable (it's DOM).
- Copy is real DOM text (screen-readers get the narrative); canvas is
  `aria-hidden`. `#join` link reachable/focusable at all times for keyboard
  users (visually hidden until shown).
- DPR capped at 2; single rAF; skip rendering when `document.hidden`; skip
  when `p` and clock-driven ambience produce no visible change budget-wise.
- Cull by z-range before sorting; reuse scratch arrays (no per-frame alloc).
- Gradients rebuilt only when grade keyframe segment changes, else cached.

## Build order (each step is shippable/inspectable)

1. **Skeleton** — `movie.ts`: scroll→`p` smoothing, canvas sizing, grade
   keyframes, sky + ground + horizon + fog bands render. Scrolling changes
   time of day. *(index.astro already wired.)*
2. **The walk** — projection, path spline, hill ground-line, player figure
   rear-view walking with scroll velocity. Beats 1–2 feel done.
3. **Words** — beat band table + overlay driver (title card, captions, hint).
   Full copy scrubs correctly.
4. **Crowds** — rival crowds with hostility ramp (beats 3–5), fellow walkers
   + summit gathering (beats 6–7).
5. **Sunrise** — sun disc, rays, warmth tween, mist burn-off (beat 8).
6. **Finale** — aerial blend, letter sampling + assignment, Join Us reveal
   (beat 9).
7. **Polish** — reduced motion, mobile perf pass (crowd multiplier, DPR),
   cross-browser scroll feel, QA on touch.

## Storyboard (source)

1. Plain white background: **WHERE CAN WE FIND OUR HOPE?**
2. Lone figure in silhouette, pre-dawn mist, dark cold-blue sky; hill in the
   middle distance with a pale winding path; visible breath.
   **SO MANY OF US FEEL ISOLATED, POWERLESS, DISILLUSIONED**
3. Two rival crowds materialise from the mist either side of the path,
   backlit jagged silhouettes, banners/placards, shouting at each other.
   **WE CAN FEEL MORE DIVIDED THAN EVER**
4. The figure steps forward down the centre between the crowds; people lean
   in, accusatory. **BUT THERE IS ANOTHER WAY**
5. The figure keeps walking; hostility fades behind into the mist.
   **A WAY TO HEAL OUR DIVISIONS**
6. Climbing the hill, sky warming; other silhouettes emerge, all walking the
   same direction. **TO RECLAIM OUR POWER**
7. Near the top: a growing crowd at the summit, joined from all sides.
   **TO MAKE US BELIEVE IN "US" AGAIN**
8. The figure crests the hill as the sun breaks the horizon — rays, mist
   banished, faces of all ages/backgrounds turned to the light.
9. Camera soars overhead: the summit a sunlit island above the mist, the
   crowd arranged into letters — **WE THE PEOPLE**.
