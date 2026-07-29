# PostHog post-wizard report

The wizard has completed a full PostHog integration for the We The People (WTP) static Astro site. PostHog is initialised once in `src/components/posthog.astro` (loaded via `src/layouts/Layout.astro`) using the CDN snippet with `is:inline` to avoid TypeScript processing. Environment variables are stored in `.env`. Global unhandled error tracking is wired up in the component. Five custom events have been instrumented across the key pages.

| Event name | Description | File |
|---|---|---|
| `join_page_viewed` | User lands on the Join Us page — top of the sign-up conversion funnel. | `src/pages/join.astro` |
| `join_signup_attempted` | User fills in their email address on the sign-up form, indicating intent to join. | `src/pages/join.astro` |
| `homepage_panel_clicked` | User clicks one of the three content panels on the homepage (The Idea, In Practice, or Join Us). Includes `panel_title` property. | `src/pages/index.astro` |
| `idea_article_read` | User scrolls to the bottom of The Idea article, indicating they read it in full. | `src/pages/idea.astro` |
| `practice_article_read` | User scrolls to the bottom of the In Practice article, indicating they read it in full. | `src/pages/practice.astro` |

## Next steps

We've built a dashboard and five insights to track user behaviour from the moment they land on the homepage through to signing up:

- [Analytics basics (wizard) — Dashboard](https://eu.posthog.com/project/235802/dashboard/857419)
- [Join page views (wizard)](https://eu.posthog.com/project/235802/insights/FUxasSrM)
- [Homepage panel navigation (wizard)](https://eu.posthog.com/project/235802/insights/D4ovdr13)
- [Sign-up conversion funnel (wizard)](https://eu.posthog.com/project/235802/insights/qzREarYZ)
- [Article read completions (wizard)](https://eu.posthog.com/project/235802/insights/9XWap8wE)
- [Full engagement-to-join funnel (wizard)](https://eu.posthog.com/project/235802/insights/00IsAmeI)

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` to `.env.example` and any bootstrap scripts so collaborators know what values to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-astro-static/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
