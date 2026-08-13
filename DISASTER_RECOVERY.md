# Disaster recovery: rebuilding this project from nothing

This is the answer to "GitHub, Cloudflare, and Supabase accounts are all
gone, how do I get back to exactly where this project was." Written
2026-08-13. Pairs with `OPERATIONS.md` (the detailed why/how of every
decision) and `scripts/disaster-recovery.sh` (the runnable half of this
document).

## The honest version first

Full "zero manual steps, seconds" recovery isn't actually possible, and
claiming otherwise here would just mean this doc lies to you at the worst
possible time. Every provider involved (GitHub, Cloudflare, Supabase)
deliberately puts a human-only gate in front of account creation and initial
credential issuance — email verification, ToS acceptance, OAuth consent
screens, personal access token generation. That's not a gap in this
project's automation, it's those providers' own security model working as
designed, and no script can click through it on your behalf.

What this document actually gets you: **every step that isn't one of those
human-only gates is scripted**, and the human-only gates are narrowed down
to the smallest possible list, done once, near the start, with exact links.
After that handful of manual actions, one script does the rest.

## The irreducible manual steps (do these first, in order)

1. **Create the three accounts**, if they don't already exist: GitHub
   (github.com/signup), Cloudflare (dash.cloudflare.com/sign-up), Supabase
   (supabase.com/dashboard/sign-up). Free tier is fine for all three, this
   project has run entirely on free tiers since it started.
2. **Authenticate the CLIs**, each a one-time interactive login:
   - `gh auth login` (GitHub CLI, needed for repo creation + secrets)
   - `npx wrangler login` — **must be run with a backgrounded/non-blocking
     process**, the OAuth callback listener dies before you can click
     "Allow" in the browser otherwise (a real gotcha hit setting up the
     original project, see `OPERATIONS.md`'s "Accounts" section).
   - `supabase login` (needed once, mainly to confirm the account, project
     creation itself uses a Personal Access Token instead, see next step)
3. **Generate a Supabase Personal Access Token**:
   supabase.com/dashboard/account/tokens → "Generate new token". Supabase's
   Management API (project creation, renaming, etc.) requires this, and
   there's no CLI-only path to get one, it's a dashboard-only, human-gated
   action by design. Export it: `export SUPABASE_ACCESS_TOKEN=sbp_...`
4. **Generate a Cloudflare API token** scoped for Workers deploys:
   dash.cloudflare.com → My Profile → API Tokens → "Create Token" → use the
   "Edit Cloudflare Workers" template (the exact same template the original
   staging setup used). Export it: `export CLOUDFLARE_API_TOKEN=...`

That's it. Four things, all one-time, all requiring a human click through a
provider's own security gate. Everything below this line is scripted.

## What `scripts/disaster-recovery.sh` automates

Given the four exports above are set, the script:

1. **Creates the GitHub repo** (`gh repo create`) and pushes this codebase
   to it.
2. **Creates two Supabase projects** via the Management API
   (`api.supabase.com/v1/projects`): one for dev/production (shared, see
   `OPERATIONS.md`'s "Decisions made" for why dev and production share one
   project — a real Supabase free-tier limit, not a design choice), one for
   staging, matching this project's actual current split.
3. **Applies all 11 migrations** to both new projects using
   `scripts/apply-migration.sh` (direct `psql`, the same scripted path
   documented in `OPERATIONS.md`, not the dashboard SQL Editor).
4. **Creates the two admin accounts** (production + staging) through the
   real Supabase Auth Admin API and grants them `admin_roles` access, the
   same pattern `e2e/localDb.ts` already proves out for tests.
5. **Creates the Cloudflare Worker for staging**
   (`wrangler deploy --config wrangler.staging.toml`) and sets up the
   GitHub Actions secrets it needs.
6. **Sets every GitHub Actions secret** this repo's workflows expect
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`,
   `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN`) via
   `gh secret set`, pulling values straight from the API responses above,
   never asking you to copy-paste a key by hand.
7. **Enables GitHub Pages** ("Deploy from GitHub Actions" source) via the
   GitHub API.
8. **Pushes to `main` and `staging`**, which fires every existing workflow
   (`ci.yml`, `deploy-pages.yml`, `deploy-staging.yml`,
   `data-retention*.yml`, `keep-alive*.yml`) exactly the way they already
   run today, no changes needed to any workflow file.

**Deliberately NOT automated**: the Cloudflare **Pages** project for dev
(`landonkea-workingtitle.pages.dev`). Connecting a GitHub repo to Cloudflare
Pages' git-integration flow requires authorizing Cloudflare's GitHub App
against the repo, which is itself a GitHub-side OAuth consent click, the
same category of human-only gate as the four steps above. Everything else
(staging's Worker, all secrets, all scheduled jobs, the whole database)
comes back with zero manual clicks beyond the four setup steps.

### Reconnecting Cloudflare Pages for dev (the one manual piece), exact steps

1. Go to `dash.cloudflare.com` → **Workers & Pages** → **Create** → **Pages**
   tab → **Connect to Git**.
2. Authorize the Cloudflare GitHub App against the rebuilt repo (the OAuth
   consent click referenced above) and select it from the list.
3. Project setup screen:
   - **Project name**: `landonkea-open-navigation-geospatial-platform`
     (the name is cosmetic and renameable later, see `OPERATIONS.md`'s
     "Decisions made" section; it does NOT determine the live domain).
   - **Production branch**: `main`
   - **Framework preset**: None
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/` (leave default)
4. Before the first deploy, add environment variables (Settings →
   Environment variables, for BOTH the "Production" and "Preview" scopes):
   - `VITE_SUPABASE_URL` = the rebuilt project's production Supabase URL
     (printed at the end of `disaster-recovery.sh`'s run)
   - `VITE_SUPABASE_ANON_KEY` = the rebuilt project's production anon/
     publishable key (same source)
5. Save and deploy. Cloudflare assigns a fresh `*.pages.dev` subdomain on
   this first deploy, it will NOT be `landonkea-workingtitle.pages.dev`
   again unless that exact project slug happens to still be free (Pages
   subdomains are tied to whichever project claims them first and are not
   reliably recoverable after a project is deleted). Update any hardcoded
   references to the old domain (this doc, `OPERATIONS.md`, any QR codes
   already printed/shared) once the new one is known.
6. Verify with a direct `curl` against the new URL's root and `/admin`
   before trusting it, same as every other verification step in this doc,
   an automatic-redirect config mistake here has bitten this project for
   real before (`OPERATIONS.md` bug #16).

## A time-sensitive risk in the key-fetching step, flag before it bites

Step 4 above (`get_project_keys` in the script) reads each new project's
`anon` and `service_role` keys by name from Supabase's Management API.
Supabase's newer projects can also carry a second, parallel key system
(`sb_publishable_...` / `sb_secret_...`, see the real keys already in use
in `OPERATIONS.md`'s "Accounts" section) alongside the classic pair, and
Supabase has stated the classic `anon`/`service_role` JWT keys will be
deprecated by the end of 2026. If a rebuild is attempted after that
deprecation actually takes effect, `get_project_keys`'s name-based lookup
may return nothing and every downstream secret/env var would come back
empty instead of failing loudly. **Before relying on this script after
2026**, confirm `curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
"https://api.supabase.com/v1/projects/<ref>/api-keys?reveal=true"` still
returns an `anon`/`service_role`-named pair for a fresh project, and if
not, update `get_project_keys` to match on the `type` field
(`publishable`/`secret`) instead.

## Safety: this script refuses to run destructively

`scripts/disaster-recovery.sh` checks for an existing GitHub repo, existing
Supabase projects with matching names, and an existing Cloudflare Worker
before doing anything, and aborts with a clear error rather than creating
duplicates if any of those already exist. It's meant for the actual "this
is genuinely gone" scenario, not for casual re-runs against a live project.

## If you only lost one piece, not all three

Most real scenarios are smaller than "everything is gone." Each numbered
step above is independently re-runnable:
- Lost only the Supabase project? Steps 2-4 alone rebuild it, migrations
  and admin accounts included.
- Lost only the Cloudflare Worker? Step 5 alone rebuilds staging.
- Rotated a leaked credential? Step 6 alone re-syncs GitHub secrets from
  whatever's currently live, no rebuild needed.

## After recovery: verify, don't assume

Once the script finishes, don't trust a green "success" message alone, this
project's own history (`OPERATIONS.md`'s "Real bugs found and fixed", bug
#17 especially) is full of cases where a step reported success but the real
state was wrong. At minimum:
```bash
npm run type-check && npm run test
curl -s -o /dev/null -w "%{http_code}\n" https://<new-dev-url>/
curl -s -o /dev/null -w "%{http_code}\n" https://<new-staging-url>/
```
and confirm a real end-to-end ride (create → start → join → position update)
against both, the same way every feature in `OPERATIONS.md` was verified,
not just against a curl 200.
