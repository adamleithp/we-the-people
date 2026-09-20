# Editing the words on the site

Every word on wethepeoplegather.com lives in five files under
[`src/content/`](./src/content). They can be changed two ways, and both end in
the same place — a commit on `main`, which redeploys the site in about two
minutes:

- **In a browser, at [wethepeoplegather.com/admin](https://wethepeoplegather.com/admin)** —
  a form per page, no code. This is the one to hand to someone non-technical.
- **In the repository**, by editing the YAML files directly.

Nothing is lost either way: an edit made in the browser is an ordinary commit,
so it shows up in the repository's history and can be reverted like any other.

## For an editor

1. Go to **wethepeoplegather.com/admin** and sign in (see *Signing in* below).
2. Pick a page from the list: Home, The Idea, In Practice, Join Us, or
   Header & search.
3. Change the words. **Save** publishes.
4. Give it two minutes, then reload the page to see it live.

A deck page — The Idea, In Practice — is a stack of **blocks**, one per
paragraph. Add, delete and drag them to reorder. The kind of block decides how
it looks:

| Block | What it is |
| --- | --- |
| Paragraph | ordinary body text |
| Heading | a section heading in the caps display face |
| Opening statement | the first big line of the page — one, at the top |
| Lead paragraph | the larger paragraph under it |
| Pull quote | the line set off with a yellow rule |
| Bullet list | a list of points |
| Footnote | the small grey note at the foot — one, at the bottom |

Inside any text you can write:

- a link — `[the words people click](https://example.com)`, or
  `[our address](mailto:hello@wethepeoplegather.com)`
- emphasis — `**bold**` or `_italics_`

Anything else you type stays exactly as typed, including `<` and `&`. To point
at the footnote from the text above it, link to `[*](#fn1)`.

Two things worth knowing before you change them:

- **The big glass title** on each page is shattered into fragments at build
  time. Short lines hold together; long ones get small and thin.
- **The sign-up form's labels** are yours to reword. The answers still reach us
  the same way. The drop-down of ways to contribute is reported in the
  analytics, so renaming an option starts a fresh line in the numbers rather
  than continuing the old one.

## Signing in

**Today: with a personal access token.** Each editor needs a GitHub account
with write access to this repository, and a token to paste in once:

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. Repository access: **Only select repositories** → `adamleithp/we-the-people`.
3. Permissions: **Repository permissions** → **Contents** → **Read and write**.
4. Generate it, copy it, and paste it into **Sign In Using Access Token** at
   `/admin`. The browser remembers it. It stops working on the expiry date set
   when the token was generated, and a new one is made the same way.

**Better: a "Sign in with GitHub" button.** That needs a tiny OAuth relay,
because GitHub will not hand a token to a static site directly.
[Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth) is one
worker on Cloudflare's free tier — the same account that already serves this
site's DNS. Once, about fifteen minutes:

1. Deploy the worker from that repository (one-click button, or
   `npx wrangler deploy` from a clone).
2. Note its address from the Cloudflare dashboard. It looks like
   `https://sveltia-cms-auth.<your-subdomain>.workers.dev`.
3. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth
   App**. Homepage URL `https://wethepeoplegather.com`; **Authorization callback
   URL** the worker's address with `/callback` on the end.
4. In the Cloudflare dashboard, under the worker's **Settings → Variables**, set
   `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from that OAuth app (encrypt
   the secret), and `ALLOWED_DOMAINS` to `wethepeoplegather.com`.
5. In [`public/admin/config.yml`](./public/admin/config.yml): delete the
   `auth_methods: [token]` line and uncomment `base_url`, with the worker's
   address. Push.

Editors then just click **Sign in with GitHub**, and only people with write
access to the repository can save.

Anyone can *open* `/admin` — it is a public page on a public site — but without
repository access there is nothing to sign in to and nothing to change.

## For a developer

```
src/content/*.yml        the words: home, idea, practice, join, site
src/lib/content.ts       loads and types them; the pages import from here
src/lib/inline.ts        the [link](…) / **bold** / _italics_ in a line of copy
src/components/Prose.astro   turns a deck page's blocks into the 70ch column
public/admin/config.yml  the same fields, described for the editor
scripts/check-content.mjs    fails the build if those two drift apart
```

`src/content/*.yml` is imported straight into the pages by
[`@rollup/plugin-yaml`](https://github.com/rollup/plugins/tree/master/packages/yaml),
so editing a file in the repository hot-reloads in `npm run dev` like any other
source change.

Adding a field means touching both sides — the shape in `src/lib/content.ts` and
the field in `public/admin/config.yml`. `npm run check:content` (which `npm run
build` runs first, so CI enforces it) compares every key in the content files
against the fields the CMS offers and names anything that only exists on one
side.

**The CMS is pinned.** `public/admin/index.html` loads Sveltia CMS from a CDN at
an exact version, because that page holds write access to this repository. To
update, bump the version in that file and check that `/admin` still saves.

**Comments are not preserved.** The CMS rewrites a content file wholesale when
it saves, so a comment added by hand to `src/content/*.yml` disappears the first
time someone edits that page in a browser. Explanations belong in the `hint` of
the matching field in `config.yml`, where the editor actually reads them.

**Review before publishing.** Saving commits to `main` directly. To make edits
arrive as pull requests instead, add `publish_mode: editorial_workflow` to
`public/admin/config.yml`. Editors then get Draft / In review / Ready, and
someone with repository access merges.
