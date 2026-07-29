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
- **Home** (`/`) — 85vh hero wordmark, then three flexed panels: The Idea → `/idea`, In Practice → `/practice`, Join Us → `/join`.
- **Deck pages** (`/idea`, `/practice`) — title hero, then slide-deck sections 1 and 2 as plain text in a 70ch column (`.prose` in `src/styles/base.css`). Text only for now; design later.

### Motion rules (per Emil Kowalski's animations.dev)

- **`.pane` in `base.css` is the contract.** `<GlassIntro>` and `<PageHero>` must use the same `.pane--*` modifier and the same `--lines` — that's the only reason the shattered title lands exactly on the real heading. Changing one without the other breaks the handoff.
- **Frequency sets duration.** Homepage intro is cinematic (2.4s flight); section pages are seen repeatedly, so theirs runs at ~half that. Entrances are `ease-out` — never `ease-in`.
- **Only `transform`/`opacity` animate.** An animated `filter: blur()` re-rasterises every shard layer each frame and drops frames; it was measured and removed.
- **The intro fades its backdrop, not itself.** Fading the whole overlay composites the shards as a group and hairline seams appear between them.
- `intro-sealing` on `<html>` releases `.fade-up` content while the glass is still lifting; the tagline leads, then the cue, then the header (~120ms apart).
- Legacy from the earlier scroll-movie direction (unused by the current pages): `ShardField.astro`, `StoryBlock.astro`, `GlassAssembly.astro`, `src/scripts/glass.ts`, `MOVIE.md`, `DESIGN.md`.

## Analytics

PostHog, **EU cloud** (`https://eu.i.posthog.com`, project 235802 in the We The People org). Init lives in `src/components/posthog.astro`, loaded from `Layout.astro`; keys come from `.env` (`PUBLIC_POSTHOG_PROJECT_TOKEN`, `PUBLIC_POSTHOG_HOST` — see `.env.example`). Pageviews and autocapture are on by default.

- Sign-up: `/join` mirrors wethepeoplegather.com's fields — name, email, "how you can contribute" (select), "anything else" (textarea). On submit: `identify(email, { email, name, contribution, message })` then `capture('join_us_submitted', { contribution, has_message })`, then the thank-you overlay. PII lives on the **person profile, never in event properties** — PostHog's own rule — so the event stays safe to break down on.
- Action **Joined Us (form submitted)** (id 146569) matches `join_us_submitted`; workflow **Welcome Email Sequence** (`019fad20-ee9b-0000-b1df-7e8ddacd85bd`) triggers off that action, sends the welcome email, exits. Masked to once per person per 30 days. It is a **draft** — enabling is a deliberate, user-approved step, and delivery also needs a verified sender domain (Messaging settings) for `hello@wethepeoplegather.com`.
- The PostHog MCP connector is authed against **US** cloud, so it cannot see this project. Driving it over MCP needs an EU personal API key.
- Verifying captures with Playwright/Puppeteer: posthog-js's bot filter silently drops every capture unless `navigator.webdriver`, the UA, and `navigator.userAgentData` are all overridden. Stub `window.posthog` instead, and block `*.posthog.com` so smoke tests don't write to the real project.

## Conventions

- Keep `OVERVIEW.md` as the canonical concept doc; update it (not scattered notes) when the movement's framing changes.
- Update this file when project structure, tooling, or workflow changes.
