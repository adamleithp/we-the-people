> **Idea 3 — The Movie (current direction, v2)** is specced in [`MOVIE.md`](./MOVIE.md):
> scroll-scrubbed 9-beat film, behind-figure pseudo-3D camera, sunrise finale
> spelling WE THE PEOPLE from above. Ideas 1 & 2 below are kept for reference.

# Design idea 1 

explained a sequence of scenes, as we scroll, we pass through the scenes.
On the screen is a sort of top-down 3d space, very minimal. One the screen we have little people who are 
You can see an example of what i want the people to look like in ./examples/*.png

## Scene 1
Denote: the people are isolated
the people are isolated, or small groups of people

## Scene 2
Denote: the people feel useless, desparaging due to the state of the world

## Scene 3
Denote: we somehow show outside influence, causing some of the people to turn angry.

## Scene 4
Denote: the angry people move off to one side, those on the angry side grow very angry, showing divisiveness between all people... the sides are arguing... 

## Scene 5
Denote: enter WTP, bringing the (non angry) people together under one cause, shows love growing
WTP sits in the center

## Scene 6
Denote: WTP grows stronger, all non angry people are forming around the center, some "angry" people are joining in

## Scene 7
Denote: WTP grows stronger, and stronger, finally there are no more angry people

## Scene 8
Denote: people are all organized towards a greater cause, some people are still visibly angry, but they're supporting eachother, suggesting that all kinds of people can be under one cause.

---

## Build notes (idea 1)

Reference art: `./examples/*.png` — small volumetric silhouette figures (white body, dark outline) seen at a low oblique angle, crowds overlapping by depth. `running example.png` already shows the Scene 5/7 target: a ring of people around one lone central figure.

The 8 scenes are the manifesto arc: isolation → despair → outside agitation → division → WTP gathers people (center) → grows → anger dissolves → diverse unity. **Scroll drives scene progress; figures lerp between per-scene formations.**

### Recommended: pure HTML/JS, Canvas 2D, sprite figures, faked 2.5D. No framework, no WebGL.

- **One `<canvas>`**, one `requestAnimationFrame` loop. Hundreds of sprites = trivial for canvas (DOM/SVG would choke past a few hundred animated, z-sorted nodes).
- **Each person** = `{ x, y, state, animPhase, side, target }` on a 2D ground plane. Project to screen with a simple oblique transform: depth (`y`) → vertical offset + scale, so nearer figures are bigger and drawn last. Sort by depth each frame (painter's algorithm) → the overlapping look in the examples.
- **Walk cycle = a small sprite sheet** (~6–8 frames), advanced by `animPhase`. `standing`/`idle` = a frame or two. At the size figures appear on screen, a sprite walk reads perfectly — procedural skeletal limb-math is wasted detail here and won't reproduce the rounded, shaded look.
- **Choreography**: scroll position → scene `t` (0..1 across 8 scenes). Each scene defines a target formation (scatter, two opposed sides, ring-around-center, ordered grid). Each frame, ease every figure toward its target; figures auto-orient/walk while moving, switch to `standing` when arrived. State (calm/angry) is a per-figure flag tweened by scene → tint/posture.

### The one real fork
- **2.5D canvas sprites (recommended)** — lightweight, pure HTML/JS, matches the hand-drawn example art exactly, easy to ship. Trade-off: fixed camera, fake depth.
- **Real 3D (Three.js, instanced skinned mesh + walk clip)** — true camera moves, organic crowd, scales to thousands. Trade-off: heavier, a library, more asset work (rigged model). Only worth it if we want real 3D camera language.

Lean canvas unless we specifically want a moving 3D camera.

### Non-negotiables
- `prefers-reduced-motion`: render static formations per scene, no walk animation; scrubbing scenes still works.
- Perf: single canvas + single rAF; pause when offscreen / tab hidden; cap DPR.
- Sprite art: one figure walk sheet to start; variety via per-figure scale/speed/phase jitter + flip.

### Next step
Prototype: canvas with ~80 sprite figures, scroll scrubbing 2–3 scenes (scatter → divide → ring-around-center), walk⇄stand. Validate feel before drawing final art / wiring all 8 scenes.

---

## Idea 2 — The Walk (fork of idea 1)

Same world and figures, but **interactive**. You control **one character** and walk *down* through the country. The 8 scenes are **regions along the journey**, not scroll frames — they unfold *around you* as you pass through. The narrative still works (loosely): you are a citizen travelling through a divided nation and into the movement.

- **You play a person.** Start alone at the top. Walk down (arrow keys / WASD). Camera follows you, looking a little ahead.
- **Scenes are places.** Each manifesto beat is a zone you walk into: isolation → despair → agitation (figures near you turn angry) → division (sides split) → WTP gathers people at the centre → unity. Reaching a zone triggers its tableau.
- **Climax = arrival.** You walk into the gathering at the centre (the `running example.png` ring). The journey ends on the wordmark + **Join Us** CTA — the interaction *is* the funnel.

### Build — reuses idea 1's engine almost entirely
Same canvas + single rAF + 2.5D billboard figures + depth sort + procedural walk cycle. What changes:
- **Controller**: scroll-scrubber → **player input + follow-camera**. World translates by `-camera`; camera eases toward the player.
- **Layout**: per-scene *formations* → a **long vertical world** with crowds placed in zones down the walk axis.
- **Triggers**: figure state (calm/angry, scatter/gather) flips by the player's position in the world rather than by scroll `t`.

So engine = shared; idea 1 and idea 2 are just two *controllers* over it.

### Control scheme (recommended)
Free top-down walk (WASD / arrows), main axis downward. Alternative: auto-walk-forward + steer left/right (more cinematic, less agency) — easy to switch later. Touch: drag/tap-to-move for mobile.

### Beat timing (cinematography)
Text is treated as **title cards cut to the action**, not threshold triggers. Each beat owns a world-y band `[in, out]`; opacity fades in (~150px), **holds across the whole scene**, fades out (~200px) before the band ends — so legibility tracks the action regardless of walk speed. Leads precede each action; blank gaps between beats are the "breath".

| # | Line | in → out | register |
|---|------|----------|----------|
| 1 | We start alone. | 60 → 900 | title (bookend) |
| 2 | The world wears us down. | 1000 → 1750 | subtitle |
| 3 | Something stirs us to anger. | 1850 → 2650 | subtitle |
| 4 | We split into sides. | 2450 → 3450 | subtitle (leads the split, which eases from 2350) |
| 5 | But there is another way… | 3550 → 3950 | subtitle (pivot, in the quiet stretch) |
| 6 | We the People. | 4050 → 4720 | title; opacity also couples to `distC` so it strengthens as the crowd closes |

Placement: screen-anchored upper band (leading-room keeps the action below clear); the two `big` bookends drop to centre as title cards. The arrival overlay (logo + Join Us) replaces beat 6 at the centre.

### Prototype scope (this pass)
Single procedural figure (no art assets yet — drawn on canvas), full-screen canvas, ~70 NPCs across ~5 zones (alone → despair → anger → divide → ring-at-centre), follow-camera, walk⇄stand, per-zone caption text, arrival overlay with Join Us. Route: `/walk`. Validate feel; swap in real figure art + all 8 beats after.

