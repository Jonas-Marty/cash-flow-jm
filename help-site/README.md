# Cashflow help site

The user guide, served at **https://help.cash-flow.wi-wo.ch**.

It is a separate static site rather than a page inside the app, because the
guide has to explain things a reader cannot see yet — signing in, what the app
stores, how OIDC is configured. Inside the app it sat behind the auth gate in
`src/routes/__root.tsx`, so a signed-out visitor got the login screen instead.

Built with [Blume](https://github.com/haydenbleasel/blume) (Astro + Vite +
Tailwind). `blume build` emits plain HTML, CSS and a local search index; nginx
serves the folder. There is no runtime, no database and no secret here.

## Layout

```
docs/                 German — the default locale, unprefixed URLs
  01-getting-started.md … 12-oidc.md
  index.mdx           landing page
docs/en/              English — served under /en
  01-getting-started.md … 12-oidc.md
  index.mdx
blume.config.ts       locales, theme, search, deployment origin
nginx.conf            static serving rules
```

The numeric filename prefixes set sidebar order and are stripped from the URL,
so `04-iou-actions.md` is served at `/iou-actions` and `/en/iou-actions`.

## Working on it

```bash
npm install
npm run dev       # http://localhost:4321, hot reload
npm run check     # doctor, build, validate, audit, translation drift
npm run translate # fill in English from German (needs the Claude Code CLI)
```

`npm run check` is the gate. It refuses to run `validate` while `blume dev`
holds `.blume/`, so stop the dev server first.

There is a second gate outside this directory: `src/lib/docsParity.test.ts`
in the app, run by `npx vitest run`. It compares the two locales section by
section and checks the docs against the code — that every AI action is
described, every metric named in the README, every page reachable from
`helpUrl.ts`, and every external host the code contacts disclosed in the
privacy notice. `help-site/known-issues.json` lists what is knowingly
outstanding; an empty list is the goal.

## Writing: German is the source

German is `defaultLocale`, so **German is where you write**. English is
generated from it by `npm run translate`, which shells out to the Claude Code
CLI, validates the structure of every reply and writes the file itself.

`blume.translations.json` records the hash of each German page at the moment
it was translated. Commit it. It is what makes `blume translate --check` able
to say "this English page is stale" — and what `npm run check` fails on.

Two things it does **not** do:

- It never overwrites an English page it has no ledger entry for. The current
  English was written by hand and was adopted as-is.
- It only notices German moving ahead of English. If English is edited
  directly and German is not, the ledger still reads "up to date" — that
  exact case is how the reconcile page ended up teaching a retired model in
  German for weeks. The parity test is what catches it, which is why both
  gates exist.

## Two rules worth knowing

**Pin every heading anchor.** Headings carry an explicit `[#slug]` marker and
the slug is derived from the *English* wording in both languages:

```md
## Rückzahlung hinzufügen [#add-repayment]
## Add repayment [#add-repayment]
```

Without the marker each locale generates its own id from its own heading text,
and a `#fragment` link breaks the moment a reader switches language.

**Links into the app must be absolute.** The docs and the app are different
origins now, so `](/settings)` resolves against the docs site and 404s. Write
`https://cash-flow.wi-wo.ch/settings`.

## How the app links here

`src/lib/helpUrl.ts` builds the URLs and is the only place that knows this
origin. It honours `VITE_HELP_URL` at build time and otherwise defaults to the
production docs site.

`/help` in the app still exists, as a redirect: every section of the old in-app
guide became a page of the same slug, so bookmarked `/help#oidc` links land on
`/oidc`. `src/lib/helpUrl.test.ts` covers that mapping.

## Deployment

Dokploy compose service in the Cash Flow project, production environment.
Compose path `./help-site/docker-compose.yml`, domain `help.cash-flow.wi-wo.ch`
to service `help` on port 80, Let's Encrypt. `watchPaths` is `help-site/**`, so
app commits do not rebuild the docs and docs commits do not rebuild the app.

It currently tracks **`dev`**, not `main`: the app has unreleased work sitting
on `dev`, and the guide describes behaviour that is already true there. Point
it back at `main` once the app is promoted — the site is static and holds no
state, so which branch feeds it is purely an editorial choice.

`help.cash-flow.wi-wo.ch` needs its own DNS record. The zone's `*.wi-wo.ch`
wildcard only matches a single label, which is why the app's dev host is
`dev-cash-flow.wi-wo.ch` rather than `dev.cash-flow.wi-wo.ch`.

There is deliberately no dev deployment — the site is static, carries no state
that can diverge from production, and `npm run dev` is a full-fidelity preview.
