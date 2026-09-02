# Deploying

The site is a static Astro build hosted on GitHub Pages at
**https://wethepeoplegather.com**.

Every push to `main` rebuilds and redeploys. There is no manual step.

## How it works

`.github/workflows/deploy.yml` runs on push to `main`:

1. `withastro/action@v3` installs dependencies and runs `astro build` on Node 22
2. It uploads `dist/` as a Pages artifact
3. `actions/deploy-pages@v4` publishes that artifact to the `github-pages` environment

A run takes roughly a minute. Watch it under
[Actions](https://github.com/adamleithp/we-the-people/actions), or trigger one by
hand from the "Deploy to GitHub Pages" workflow (`workflow_dispatch`).

The build reads `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` from
GitHub Actions **repository variables** (Settings → Secrets and variables →
Actions → Variables). A build with no token fails deliberately rather than
shipping a site where every `/join` submission is a silent no-op.

## The pieces that make the domain work

Three things have to stay in agreement. If the site starts serving from
`adamleithp.github.io`, one of them has drifted.

| Where | What | Value |
| --- | --- | --- |
| `public/CNAME` | Ships in every build; drives the Pages custom domain | `wethepeoplegather.com` |
| Repo → Settings → Pages | Source, and the custom domain field | GitHub Actions / `wethepeoplegather.com` |
| `astro.config.mjs` | `site`, used for canonical URLs and sitemaps | `https://wethepeoplegather.com` |

`public/CNAME` is the one that's easy to lose, and it is stronger than the
settings page: Astro copies `public/` verbatim into `dist/`, so the file lands at
the root of the published site, and **each deploy re-applies it**. Changing the
domain in Settings without changing this file lasts only until the next push.

## DNS

DNS is hosted at **Cloudflare** (nameservers `mario.ns.cloudflare.com` /
`marlowe.ns.cloudflare.com`), with the domain registered at Namecheap. It was
moved off Hostinger's nameservers (`pixel`/`byte.dns-parking.com`) in Sept 2026.

Every record is **DNS only** (grey cloud). Do not proxy them: GitHub terminates
TLS for this domain, and proxying puts Cloudflare's certificate in front of
GitHub's, which is a different setup than the one documented here.

### Site

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `adamleithp.github.io` |

These are GitHub's shared anycast addresses, not specific to this repo. If the
site goes dark with no failed deploy, re-check them against
[GitHub's apex domain docs](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

### Mail — do not touch without checking

`@wethepeoplegather.com` email is **live Google Workspace**. The mailboxes are at
Google; these records are only the pointers. Deleting or breaking them stops mail
delivery immediately.

| Type | Name | Value |
| --- | --- | --- |
| MX | `@` | `smtp.google.com` (priority 1) |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none` |

There is no DKIM key configured, and DMARC is at `p=none`. That is a weak
deliverability posture — adding Google's DKIM key and moving to `p=quarantine`
is worth doing.

## Deprecated: wethepeople.foundation

`wethepeople.foundation` was the original domain (Namecheap DNS, separate
account). It is no longer served — the Pages custom domain moved to
`wethepeoplegather.com`, and a domain can only have one. Its A/AAAA records still
point at GitHub, so it currently returns GitHub's "There isn't a GitHub Pages site
here" 404. Either point it at a redirect or let it lapse.

## Local development

```
npm install
npm run dev      # dev server
npm run build    # production build into dist/
npm run preview  # serve dist/ locally
```

Run `npm run build` before pushing — it catches the same failures CI would, and
the error is easier to read here than in a workflow log.

## When something breaks

**Deploy succeeded but the site 404s.** Pages is serving, but there's nothing at
that path. Check `dist/` after a local `npm run build`.

**"There isn't a GitHub Pages site here."** That page is GitHub answering, so DNS
is fine — the problem is on the Pages side. Either no deploy has run, or the
custom domain came unset (see `public/CNAME`).

**The domain doesn't resolve at all.** DNS, not GitHub. Check Cloudflare.

**Certificate errors after a domain change.** GitHub reissues the certificate
when the custom domain changes, which can take from a minute to about 15. While
`Enforce HTTPS` is greyed out the certificate hasn't been issued yet — wait
rather than changing settings, and check `http://` works in the meantime.

**Mail stops.** Check the three records above resolve. `dig MX
wethepeoplegather.com` should return `smtp.google.com`.
