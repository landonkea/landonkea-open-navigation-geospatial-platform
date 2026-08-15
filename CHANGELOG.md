# Changelog

Generated from commit history via `scripts/generate-changelog.sh`, not hand-maintained. Re-run that script to refresh it, don't hand-edit entries below, they'll just be overwritten.

## 2026-08-14

- Fix highlights XSS, recap duration rounding, and staging DB connectivity
- Add post-ride recap share card and public highlights wall
- Fix Emergency Info accuracy, duplicate notifications, and dedupe distance math
- Add Emergency Info card and checkpoint proximity toast
- Fix Duplicate-ride race, stale dashboard counts, and unescaped error text
- Add public status page, admin dashboard cards, and one-click Duplicate ride
- Fix info-panel/view-switcher overlap and dedupe clipboard-copy logic
- Fix distance-stat threshold and stroke-width logic from Batch B review

## 2026-08-13

- Add live distance/pace stats, finish-line confetti, rider color choice
- Add weather badge, nearest-rider readout, stale-dot fade, copy-link button
- Add disaster-recovery automation and production deploy scaffolding

## 2026-08-11

- Fix GPS jitter, trim rider tags, add remove-participant and device hash
- Add transparent frosted-glass cards/fields and a per-client logo slot
- Default the rider map to satellite, cap zoom before it goes blank
- Fix a slug collision in e2e test seeding under fast/parallel runs
- Add an e2e test proving two simultaneous rides never mix participants
- Fix CI: set VITE_SUPABASE_* env vars for the unit-test step too
- Regenerate lockfile with npm 10.x to match CI's npm version
- Add CI workflow running type-check, unit tests, and the e2e test
- Add an e2e test that clicks through the real rider join flow
- Fix GitHub Pages subpath bugs in service worker registration and manifest
- Add Delete Ride, GPX/CSV history import, CSV route import, and unlimited named waypoints
- Fix critical bug: tag-picker had no CSS, silently blocking every join
- Add a "Leave Ride" button
- Add retention and keep-alive jobs for the staging environment
- Restyle the app to a sunburst-orange/light-yellow theme
- Add staging deploy workflow (Cloudflare Worker via GitHub Actions)
- Add wrangler.toml for the new Cloudflare Workers-based deployment
- Rename project to Open Navigation & Geospatial Platform
- Complete Phase 4: in-app feedback + native share, no external service
- Add admin-side tag reassignment to the ride list
- Add an explicit "Start Ride" step before riders can join
- Add optional self-select rider tags to the join flow
- Fix infinite redirect loop on production /admin
- Add draw-on-map routing as an alternative to GPX upload
- Add admin-only ride list, fix a stored-XSS gap found while testing it
- Add ride data export (GPX/CSV) to the admin panel
- Populate ride_history_samples during active rides
- Add scheduled data-retention cleanup job for ended rides
- Add explicit 'End Ride' admin control, actually enforced client-side
- Add three of the build prompt's four named fallbacks (Phase 5)
- Add Phase 6 design-flow documentation (Mermaid diagrams)
- Add Add-to-Home-Screen install prompt (Phase 4, accessibility/onboarding)
- Add GPX route upload + rendering (Phase 3)
- Add screen wake lock and roster/headcount view (Phase 4)
- Add Map/Satellite view toggle
- Fix GitHub Pages redundant host: wire real Supabase credentials via Actions secrets
- Add redundant hosting on GitHub Pages, subpath-aware ride link parsing
- Fix map race condition, add explicit rider/spectator choice + location recovery guidance, short date-based ride links, rename to OpenNavigation & Geospatial Platform
- Add OPERATIONS.md to gitignore (local-only running ops log)
- Regenerate lockfile with npm 10.9.2, matching Cloudflare's build image
- Fix package-lock.json drift, was missing esbuild@0.28.2

## 2026-08-10

- Fix four real bugs found by actually running the app in a browser
- Phase 3 start: admin login + create-ride screen
- Add possibly-stuck detection and admin-specific disconnect window
- Add POST_RIDE_DISCONNECT_MINUTES as a tunable placeholder, not hardcoded
- Phase 2 core loop: join flow, polling sync, signal-color map, Supabase RLS grants
- docs: remove em dash per AI writing checklist
- Phase 1: PWA shell, MapLibre map, Supabase schema, TypeScript throughout
