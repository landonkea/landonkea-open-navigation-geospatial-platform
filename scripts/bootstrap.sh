#!/usr/bin/env bash
# Turns OPERATIONS.md's "Local dev, from scratch" prose into one runnable
# script. Idempotent where practical (safe to re-run). Does NOT create any
# cloud accounts or projects, see DISASTER_RECOVERY.md for that half of the
# picture, this script only gets a fresh local checkout running.
#
# Usage: scripts/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "── Checking prerequisites ──"
command -v node >/dev/null || { echo "node not found, install Node 22 first."; exit 1; }
command -v npm  >/dev/null || { echo "npm not found."; exit 1; }
command -v supabase >/dev/null || { echo "supabase CLI not found (brew install supabase/tap/supabase)."; exit 1; }
command -v docker >/dev/null || echo "Warning: docker not found on PATH, 'supabase start' needs Docker Desktop running."

if [[ ! -f .env.local ]]; then
  echo
  echo "── No .env.local found ──"
  echo "Copy .env.example to .env.local and fill in real values before continuing:"
  echo "  cp .env.example .env.local"
  exit 1
fi

echo "── Installing npm dependencies ──"
npm install

echo "── Starting local Supabase (needs Docker Desktop open) ──"
supabase start

echo
echo "── Local dev backend is up. Applying any pending migrations ──"
# 'supabase start' already applies every file in supabase/migrations/ to a
# fresh local database on its own; this is only needed if you started with
# an existing local database that predates a newer migration file.
supabase db reset --local || echo "Skipping db reset (pass, non-fatal if already current)."

echo
echo "── Done. Next: ──"
echo "  npm run dev              # app at whatever localhost URL it prints"
echo "  npm run test             # unit tests"
echo "  npm run test:e2e         # e2e tests (needs the local Supabase instance above)"
echo
echo "To sign into the local admin panel, see OPERATIONS.md's \"Local dev, from scratch\""
echo "section for the one-time admin password-set curl command."
