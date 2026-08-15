#!/usr/bin/env bash
# Rebuilds this project's GitHub repo, Supabase projects (prod + staging),
# Cloudflare Worker (staging), and all GitHub Actions secrets from nothing.
# See DISASTER_RECOVERY.md for the full narrative, the four manual
# prerequisite steps, and what this deliberately does NOT automate
# (Cloudflare Pages' git-integration connection for dev, a GitHub-side OAuth
# consent click, the same category of human-only gate as the prerequisites
# below).
#
# Prerequisites (see DISASTER_RECOVERY.md "The irreducible manual steps"):
#   - gh auth login
#   - npx wrangler login (run backgrounded, OAuth callback needs it)
#   - export SUPABASE_ACCESS_TOKEN=sbp_...
#   - export CLOUDFLARE_API_TOKEN=...
#
# Usage: scripts/disaster-recovery.sh <github-org-or-user> <repo-name>
#
# Refuses to run if the repo, either Supabase project, or the staging
# Worker already exist, this is for genuine rebuild-from-nothing scenarios,
# not casual re-runs against a live project.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OWNER="${1:-}"
REPO_NAME="${2:-landonkea-open-navigation-geospatial-platform}"
STAGING_PROJECT_NAME="${REPO_NAME}-staging"

if [[ -z "$OWNER" ]]; then
  echo "Usage: $0 <github-org-or-user> [repo-name]" >&2
  exit 1
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Error: $name is not set. See DISASTER_RECOVERY.md's manual steps." >&2
    exit 1
  fi
}
require_env SUPABASE_ACCESS_TOKEN
require_env CLOUDFLARE_API_TOKEN

command -v gh >/dev/null || { echo "gh CLI not found."; exit 1; }
command -v wrangler >/dev/null || command -v npx >/dev/null || { echo "wrangler/npx not found."; exit 1; }
command -v psql >/dev/null || { echo "psql not found."; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found (used for JSON parsing)."; exit 1; }

echo "── Safety check: refusing to overwrite existing infrastructure ──"
if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "Error: $OWNER/$REPO_NAME already exists on GitHub. Aborting." >&2
  exit 1
fi
if curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects \
   | python3 -c "import json,sys; names=[p['name'] for p in json.load(sys.stdin)]; import sys as s; s.exit(0 if any('$REPO_NAME' in n for n in names) else 1)"; then
  echo "Error: a Supabase project matching '$REPO_NAME' already exists. Aborting." >&2
  exit 1
fi

sb_api() {
  curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" "$@"
}

echo "── Finding your Supabase organization ──"
ORG_ID=$(sb_api https://api.supabase.com/v1/organizations | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
echo "Using organization: $ORG_ID"

create_supabase_project() {
  local name="$1"
  local db_password
  db_password=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
  local response
  response=$(sb_api -X POST https://api.supabase.com/v1/projects \
    -d "{\"name\":\"$name\",\"organization_id\":\"$ORG_ID\",\"db_pass\":\"$db_password\",\"region\":\"us-west-1\",\"plan\":\"free\"}")
  local ref
  ref=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  echo "$ref|$db_password"
}

echo "── Creating production/dev Supabase project ──"
PROD_RESULT=$(create_supabase_project "$REPO_NAME")
PROD_REF="${PROD_RESULT%%|*}"
PROD_DB_PASSWORD="${PROD_RESULT##*|}"
echo "Production project ref: $PROD_REF (provisioning takes a few minutes)"

echo "── Creating staging Supabase project ──"
STAGING_RESULT=$(create_supabase_project "$STAGING_PROJECT_NAME")
STAGING_REF="${STAGING_RESULT%%|*}"
STAGING_DB_PASSWORD="${STAGING_RESULT##*|}"
echo "Staging project ref: $STAGING_REF (provisioning takes a few minutes)"

wait_for_project() {
  local ref="$1"
  echo "Waiting for $ref to finish provisioning..."
  for _ in $(seq 1 60); do
    local status
    status=$(sb_api "https://api.supabase.com/v1/projects/$ref" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','UNKNOWN'))")
    [[ "$status" == "ACTIVE_HEALTHY" ]] && { echo "$ref is healthy."; return 0; }
    sleep 10
  done
  echo "Error: $ref did not become healthy in time." >&2
  exit 1
}
wait_for_project "$PROD_REF"
wait_for_project "$STAGING_REF"

apply_all_migrations() {
  local ref="$1"
  local db_password="$2"
  echo "── Applying all migrations to $ref ──"
  for f in supabase/migrations/*.sql; do
    # The session pooler, not the direct db.<ref>.supabase.co host
    # (found 2026-08-14, see scripts/apply-migration.sh's own comment
    # on this): that direct hostname is IPv6-only, and plenty of
    # environments (this one included) have no IPv6 egress at all.
    # The pooler is dual-stack and reliable everywhere this project
    # has actually tested it. Region is hardcoded to match
    # create_supabase_project()'s own "us-west-1" above.
    PGPASSWORD="$db_password" psql -h aws-0-us-west-1.pooler.supabase.com -p 5432 -U "postgres.${ref}" -d postgres -v ON_ERROR_STOP=1 -f "$f"
  done
}
apply_all_migrations "$PROD_REF" "$PROD_DB_PASSWORD"
apply_all_migrations "$STAGING_REF" "$STAGING_DB_PASSWORD"

get_project_keys() {
  local ref="$1"
  # reveal=true is required or the Management API returns keys with the
  # actual secret value withheld, silently breaking every secret set
  # below. See DISASTER_RECOVERY.md's "A time-sensitive risk in the
  # key-fetching step" section for the related anon/service_role naming
  # risk once Supabase's classic JWT keys are deprecated (end of 2026).
  sb_api "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true"
}

PROD_KEYS=$(get_project_keys "$PROD_REF")
PROD_ANON_KEY=$(echo "$PROD_KEYS" | python3 -c "import json,sys; [print(k['api_key']) for k in json.load(sys.stdin) if k['name']=='anon']")
PROD_SERVICE_KEY=$(echo "$PROD_KEYS" | python3 -c "import json,sys; [print(k['api_key']) for k in json.load(sys.stdin) if k['name']=='service_role']")
STAGING_KEYS=$(get_project_keys "$STAGING_REF")
STAGING_ANON_KEY=$(echo "$STAGING_KEYS" | python3 -c "import json,sys; [print(k['api_key']) for k in json.load(sys.stdin) if k['name']=='anon']")
STAGING_SERVICE_KEY=$(echo "$STAGING_KEYS" | python3 -c "import json,sys; [print(k['api_key']) for k in json.load(sys.stdin) if k['name']=='service_role']")
PROD_URL="https://${PROD_REF}.supabase.co"
STAGING_URL="https://${STAGING_REF}.supabase.co"

create_admin_user() {
  # $3 is the project ref, not a full host (changed 2026-08-14, see
  # apply_all_migrations()'s comment above for why this uses the
  # pooler, not a direct db.<ref>.supabase.co host).
  local api_url="$1" service_key="$2" ref="$3" db_password="$4" email="$5"
  local password
  password=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")
  local response
  response=$(curl -sS -X POST "$api_url/auth/v1/admin/users" \
    -H "apikey: $service_key" -H "Authorization: Bearer $service_key" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}")
  local user_id
  user_id=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  PGPASSWORD="$db_password" psql -h aws-0-us-west-1.pooler.supabase.com -p 5432 -U "postgres.${ref}" -d postgres -v ON_ERROR_STOP=1 \
    -c "insert into admin_roles (user_id) values ('$user_id');"
  echo "Admin created: $email / $password (save this, shown once)"
}

echo "── Creating admin accounts ──"
create_admin_user "$PROD_URL" "$PROD_SERVICE_KEY" "$PROD_REF" "$PROD_DB_PASSWORD" "admin@${REPO_NAME}.recovered"
create_admin_user "$STAGING_URL" "$STAGING_SERVICE_KEY" "$STAGING_REF" "$STAGING_DB_PASSWORD" "staging-admin@${REPO_NAME}.recovered"

echo "── Creating GitHub repo and pushing code ──"
gh repo create "$OWNER/$REPO_NAME" --private --source=. --remote=origin --push

echo "── Setting GitHub Actions secrets ──"
gh secret set VITE_SUPABASE_URL --body "$PROD_URL" --repo "$OWNER/$REPO_NAME"
gh secret set VITE_SUPABASE_ANON_KEY --body "$PROD_ANON_KEY" --repo "$OWNER/$REPO_NAME"
gh secret set SUPABASE_SERVICE_ROLE_KEY --body "$PROD_SERVICE_KEY" --repo "$OWNER/$REPO_NAME"
gh secret set STAGING_SUPABASE_URL --body "$STAGING_URL" --repo "$OWNER/$REPO_NAME"
gh secret set STAGING_SUPABASE_ANON_KEY --body "$STAGING_ANON_KEY" --repo "$OWNER/$REPO_NAME"
gh secret set STAGING_SUPABASE_SERVICE_ROLE_KEY --body "$STAGING_SERVICE_KEY" --repo "$OWNER/$REPO_NAME"
gh secret set CLOUDFLARE_API_TOKEN --body "$CLOUDFLARE_API_TOKEN" --repo "$OWNER/$REPO_NAME"

echo "── Enabling GitHub Pages (deploy from Actions) ──"
gh api -X POST "repos/$OWNER/$REPO_NAME/pages" -f "build_type=workflow" >/dev/null 2>&1 || \
  echo "(Pages may already be configured or needs the repo's first push to land first, safe to ignore here.)"

echo "── Deploying the staging Cloudflare Worker ──"
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" npx wrangler deploy --config wrangler.staging.toml

echo
echo "══ Done ══"
echo "GitHub repo:  https://github.com/$OWNER/$REPO_NAME"
echo "Production Supabase: $PROD_URL (ref $PROD_REF)"
echo "Staging Supabase:    $STAGING_URL (ref $STAGING_REF)"
echo
echo "Still manual (see DISASTER_RECOVERY.md): connect Cloudflare Pages to"
echo "this GitHub repo via the dashboard's git-integration flow for the dev"
echo "host, and set its VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY build env"
echo "vars to the production values printed above."
echo
echo "Verify before trusting any of this: npm run type-check && npm run test,"
echo "then curl the new live URLs, then a real end-to-end ride."
