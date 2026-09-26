# AGENTS.md

Source of truth for agents working in this repo. `CLAUDE.md` is a symlink to this file.

## Project

**We The People (WTP)** — a UK political movement to "Reunite the Country, Transform the System" via Citizens' Assemblies ("Councils of the People"). Current work centres on building the movement's website.

Read **[`OVERVIEW.md`](./OVERVIEW.md)** first — it is the conceptual source of truth for the movement's mission, sentiment, argument, principles, and brand. Ground all content and product decisions in it. Founding documents live in [`docs/`](./docs).

## Working principles

- **Honour the sentiment.** Hope, unity, inclusivity. Non-partisan and never alienating to any part of the political spectrum. When writing copy, match the tone in `OVERVIEW.md` ("BE PART OF HOPE").
- **Primary goal of the site is sign-ups.** "Join Us" is the most important call to action.
- **Brand:** British Racing Green `#004225` primary; dawn-yellow secondary; WE THE PEOPLE caps logo; imagery of faces + the British land. No identity-politics slant.
- **Audience is "literally everyone"** — keep it simple, accessible, mobile-first.

## Site structure (current direction)

Reference feel: [blueheart.patagonia.com](https://blueheart.patagonia.com/) — off-black, big type, minimal.

- **Glass intro** (`src/components/GlassIntro.astro`) — every page opens with its own title in glass. The title is shattered at build time into triangles (`shatter()` in `src/lib/shards.ts`); each shard is a clipped copy of the same title, so converging to `transform: none` reassembles it perfectly uniform. Replays on every load; skipped under `prefers-reduced-motion`.
- **Layout** (`src/layouts/Layout.astro`) — renders the intro and the global `<Header />`. Pages pass `introLines` (and `introVariant="hero"` for the homepage).
- **Home** (`/`) — opens on the creed instead of the glass overlay (`Layout intro={false}`): `src/components/CreedIntro.astro` fades the text in word by word, with a pause after each sentence, while the page is held (`html.intro-running`). Trying to scroll, tap or press a key speeds up the rest of the words instead of skipping them. Then the header and scroll cue fade in. Scrolling down reaches the 85vh hero wordmark, which assembles in glass as it comes into view (`<GlassIntro trigger="scroll">` in `<PageHero>`'s `glass` slot, same pane, no backdrop), then three flexed panels: The Idea → `/idea`, In Practice → `/practice`, Join Us → `/join`.
- **Deck pages** (`/idea`, `/practice`) — title hero, then slide-deck sections 1 and 2 as plain text in a 70ch column (`.prose` in `src/styles/base.css`). Text only for now; design later.

### Motion rules (per Emil Kowalski's animations.dev)

- **`.pane` in `base.css` is the contract.** `<GlassIntro>` and `<PageHero>` must use the same `.pane--*` modifier and the same `--lines` — that's the only reason the shattered title lands exactly on the real heading. Changing one without the other breaks the handoff.
- **Frequency sets duration.** Homepage intro is cinematic (2.4s flight); section pages are seen repeatedly, so theirs runs at ~half that. Entrances are `ease-out` — never `ease-in`.
- **Only `transform`/`opacity` animate.** An animated `filter: blur()` re-rasterises every shard layer each frame and drops frames; it was measured and removed.
- **The intro fades its backdrop, not itself.** Fading the whole overlay composites the shards as a group and hairline seams appear between them.
- `intro-sealing` on `<html>` releases `.fade-up` content while the glass is still lifting; the tagline leads, then the cue, then the header (~120ms apart).
- **A shard is sized to its own triangle, never to the title.** `shatter()` emits each piece's bounding box (`bx/by/bw/bh`) plus a stage-sized inner wrapper (`ox/oy/sw/sh`), and `overflow: hidden` caps the raster to the triangle. The old `inset: 0` shard was a full-wordmark box per piece — N full-title rasters, N full-title GPU textures. Keep the inner wrapper: it is what puts the title back on the same pixels.
- **Never drive a per-frame animation through custom properties.** Custom properties inherit, so writing `--k` on a shard dirties the style of every child too. `ShatterTitle`'s loop writes `style.transform` and `style.opacity` directly; measured ~5× faster frames.
- **Promote per field, not per piece.** `will-change` toggled on individual shards as they crossed the break radius made Chrome build and discard layers several times a second (200ms+ spikes). `.stitle.is-live .sshard` arms the whole stack once.
- **`.wtp-wordmark` is `white-space: nowrap`** — line breaks are authored with `<br />`. A shard's inner box lands a fraction of a pixel narrower than the real `<h1>`, which is enough to wrap the title inside every shard and nowhere else.
- **Photography lives in `src/assets/`, never `public/`.** `public/` ships files untouched; `src/assets/` goes through `getImage()`. The shard portraits were 4–40 megapixel Unsplash JPEGs painted into a few-hundred-pixel plate: 22 MB of downloads and an ~800ms decode stall on the first hover of a title. Now ~272 kB of WebP.
- **Glass Studio (`/studio`)** — unlinked, `noindex` tool for making the shatter as a video with no command line: title, style, shape (16:9 / 9:16 / 1:1), size, colours, seed shuffle, hold, HD/4K, fps, motion blur. Runs entirely in the visitor's browser. `src/lib/glass-renderer.ts` redraws the intro in WebGL2 from the same `shatter()` triangles, `shard-assemble` keyframes, easing and 1200px perspective, verified frame-for-frame against the CSS render. `src/lib/glass-export.ts` exports three formats. **ProRes 4444 `.mov` with alpha** goes through `src/lib/prores.ts`, which uses FFmpeg 9's `prores_ks` in a custom ~1 MB libav.js build in `public/libav/`, rebuilt with `scripts/build-libav.sh`. **Never encode ProRes with FFmpeg < 7** (that includes ffmpeg.wasm, which is 5.1): its alpha plays opaque on Apple Silicon in Resolve, Final Cut and Premiere, so the title sits on black, while FFmpeg's own decoder shows it fine and hides the bug. **H.264 `.mp4`** on a solid colour uses ffmpeg.wasm (`@ffmpeg/core`, ~32 MB, fetched only on Render, single-threaded because GitHub Pages can't send COOP/COEP headers). **`.zip` of PNGs** uses fflate. Motion timings live in `src/lib/intro.ts`, shared with `GlassIntro.astro`: change them there, and keep `INTRO_EASE` in step with the CSS keyframe.
- **Video export: `npm run shatter`** (`scripts/render-shatter.mjs`, after `npm i --no-save playwright-core`) renders the glass intro to a 4K PNG sequence with alpha, plus ProRes 4444 when ffmpeg is on PATH, for YouTube/After Effects. It drives `/capture/<hero|page>?title=A|B` on the dev server: `<GlassIntro capture>` with no backdrop or teardown, on a transparent page. It never ships, because `getStaticPaths` is empty outside dev. The script pauses every animation and seeks it frame by frame, and it averages sub-frames in premultiplied alpha for motion blur. It refuses to render if Anton didn't load.
- Legacy from the earlier scroll-movie direction (unused by the current pages): `ShardField.astro`, `StoryBlock.astro`, `GlassAssembly.astro`, `src/scripts/glass.ts`, `MOVIE.md`, `DESIGN.md`.

## Analytics

PostHog, **EU cloud** (`https://eu.i.posthog.com`, project 235802 in the We The People org). Init lives in `src/components/posthog.astro`, loaded from `Layout.astro`; keys come from `.env` (`PUBLIC_POSTHOG_PROJECT_TOKEN`, `PUBLIC_POSTHOG_HOST` — see `.env.example`). In CI they come from GitHub Actions **variables** of the same names, passed through in `deploy.yml`; a CI build without the token fails on purpose (`posthog.astro` frontmatter), because the site would otherwise deploy with `window.posthog` undefined and drop every sign-up. Pageviews and autocapture are on by default. Traffic goes through a **managed reverse proxy** at `e.wethepeoplegather.com` (`PUBLIC_POSTHOG_HOST`, both in `.env` and as the CI variable), because ad blockers list `*.posthog.com` and silently drop those sign-ups. `ui_host` stays on `eu.posthog.com` so replay and toolbar links still resolve. See the DNS section of `DEPLOY.md`.

- Sign-up: `/join` mirrors wethepeoplegather.com's fields — name, email, "how you can contribute" (select), "anything else" (textarea). On submit: `identify(email, { email, name, contribution, message })` then `capture('join_us_submitted', { contribution, has_message })`, then the thank-you overlay. PII lives on the **person profile, never in event properties** — PostHog's own rule — so the event stays safe to break down on.
- Action **Joined Us (form submitted)** (id 146569) matches `join_us_submitted`; workflow **Welcome Email Sequence** (`019fad20-ee9b-0000-b1df-7e8ddacd85bd`) triggers off that action: **Notify team** (transactional email of the sign-up to `hello@wethepeoplegather.com`, reply-to set to the joiner, `on_error: continue` so a failure never blocks the welcome), then the welcome email, then exit. Masked to once per person per 30 days — that masks the team notification too, so a repeat submission within 30 days is not emailed. **Active since 2026-09-11** and sending to real sign-ups. Both steps send through email integration `83759` (`hello@wethepeoplegather.com`, verified via SES) — a `from` address alone does not send, the step needs that `integrationId`. Liquid in the email step auto-escapes, so never add `| escape` — it double-escapes. Editing an active workflow stages a draft; it only goes live on publish.
- The PostHog MCP connector is single-region and single-org per auth. `organizations-list` tells you where it is; if it isn't showing "We the people", re-auth via `/mcp` and pick the EU org.
- Verifying captures with Playwright/Puppeteer: posthog-js's bot filter silently drops every capture unless `navigator.webdriver`, the UA, and `navigator.userAgentData` are all overridden. Stub `window.posthog` instead, and block `*.posthog.com` so smoke tests don't write to the real project.

## Conventions

- Keep `OVERVIEW.md` as the canonical concept doc; update it (not scattered notes) when the movement's framing changes.
- Update this file when project structure, tooling, or workflow changes.
