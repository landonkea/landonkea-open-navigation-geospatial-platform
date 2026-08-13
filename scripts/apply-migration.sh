#!/usr/bin/env bash
# Apply one (or all) Supabase migration file(s) directly to local, staging,
# or production via psql, non-interactively. Supersedes the old "paste into
# the dashboard's SQL Editor" method documented in OPERATIONS.md, see that
# doc's "Local dev, from scratch" section for the discovery that this
# connection already works with credentials already sitting in .env.local.
#
# Usage:
#   scripts/apply-migration.sh <local|staging|prod> <migration-file.sql|all>
#
# Examples:
#   scripts/apply-migration.sh staging supabase/migrations/20260811100000_add_device_hash.sql
#   scripts/apply-migration.sh prod all
#
# "all" applies every file in supabase/migrations/ in filename order. Since
# every migration in this repo is written idempotently where it matters
# (mostly "create if not exists"-style or additive), re-running an already-
# applied file is expected to be safe, but this script does not guarantee
# that on its own, if in doubt check the specific file first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-}"
MIGRATION="${2:-}"

if [[ -z "$TARGET" || -z "$MIGRATION" ]]; then
  echo "Usage: $0 <local|staging|prod> <migration-file.sql|all>" >&2
  exit 1
fi

if [[ ! -f .env.local ]]; then
  echo "Error: .env.local not found. This script needs SUPABASE_*_DB_PASSWORD from it." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

case "$TARGET" in
  local)
    PSQL_ARGS=(-h 127.0.0.1 -p 54322 -U postgres -d postgres)
    export PGPASSWORD="postgres" # supabase CLI's fixed local-only default
    ;;
  staging)
    PSQL_ARGS=(-h db.pepjyqfitgpugahtygol.supabase.co -p 5432 -U postgres -d postgres)
    export PGPASSWORD="${SUPABASE_STAGING_DB_PASSWORD:?SUPABASE_STAGING_DB_PASSWORD not set in .env.local}"
    ;;
  prod)
    PSQL_ARGS=(-h aws-0-us-west-1.pooler.supabase.com -p 5432 -U postgres.siyvrvnyipgkdatayhhc -d postgres)
    export PGPASSWORD="${SUPABASE_PROD_DB_PASSWORD:?SUPABASE_PROD_DB_PASSWORD not set in .env.local}"
    ;;
  *)
    echo "Unknown target '$TARGET', expected local, staging, or prod." >&2
    exit 1
    ;;
esac

run_one() {
  local file="$1"
  echo "── Applying $file to $TARGET ──"
  psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 -f "$file"
  echo "── Done: $file ──"
}

if [[ "$MIGRATION" == "all" ]]; then
  for f in supabase/migrations/*.sql; do
    run_one "$f"
  done
else
  if [[ ! -f "$MIGRATION" ]]; then
    echo "Error: migration file '$MIGRATION' not found." >&2
    exit 1
  fi
  run_one "$MIGRATION"
fi

echo
echo "Verify with, e.g.:"
echo "  PGPASSWORD=... psql -h ... -c \"select column_name from information_schema.columns where table_name='TABLE';\""
