# OpenNavigation & Geospatial Platform

A free, open source PWA (installable from the browser, not a native app) that shows a group's live location on a shared map during an event. Built first for a Mesa, AZ cycling meetup (bikeMesa) as its pilot client, but the core is kept generic so the same platform works for any group event, indoor kiosk wayfinding included, see [`src/theme/bike/`](src/theme/bike/) for the one place bike-specific wording/config lives, everything else is generic.

The full design spec (why every decision was made, the build phases, testing requirements) lives in `workingTitle-BUILD-PROMPT.md` at the top of the `dev/` directory (original working-title filename kept as-is, it's just a filename), that's the source of truth this code is built from.

## Stack

- TypeScript + HTML/CSS, no framework, bundled/served locally with [Vite](https://vitejs.dev/).
- [MapLibre GL JS](https://maplibre.org/) + OpenFreeMap tiles for the map (free, no per-load billing, no signup).
- [Supabase](https://supabase.com/) (Postgres + Auth) for the backend, developed locally via the Supabase CLI (no account needed for local dev), a real hosted project for production.

## Local development

```bash
npm install
npm run dev
```

Opens a local dev server (also reachable from your phone on the same WiFi, since `vite.config.js` sets `host: true`).

### Local backend (no Supabase account needed yet)

```bash
# one-time: install the Supabase CLI
brew install supabase/tap/supabase

# starts a full local Postgres + Auth + API stack in Docker,
# the exact same schema/API the real hosted free-tier project uses
supabase start

# apply supabase/schema.sql to it
supabase db reset
```

Requires Docker Desktop running. Once this app is ready for real riders (not just local development), a real hosted Supabase project gets created and the same `supabase/schema.sql` gets applied there instead, see the CHECKLIST-equivalent phase tracking in `workingTitle-BUILD-PROMPT.md`'s "Build phases" section for exactly where that step happens.

## License

MIT, see `LICENSE`. Public/open-source by design, see the build prompt's "Open source licensing" section for why.
