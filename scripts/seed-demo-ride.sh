#!/usr/bin/env bash
# Creates a realistic fake ride with fake riders scattered around Mesa, AZ
# (this project's default theme location, src/theme/bike/config.ts) for demos
# or screenshots, without touching any real ride or participant data.
#
# LOCAL ONLY, deliberately. Uses the same throwaway-admin + direct-SQL
# pattern already proven in e2e/localDb.ts, and Supabase CLI's fixed,
# publicly-documented local-only defaults (not real secrets, safe to have
# inline, matching e2e/localDb.ts's own comment on this). Never targets
# staging or production: this project's staging database is meant to mirror
# production's real schema/behavior for testing, not to accumulate demo
# clutter, and production obviously shouldn't ever get fake rides.
#
# Usage: scripts/seed-demo-ride.sh
# Needs: local Supabase running (supabase start / scripts/bootstrap.sh)

set -euo pipefail

LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOCAL_API_URL="http://127.0.0.1:54321"
LOCAL_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

# Mesa, AZ, matching src/theme/bike/config.ts's defaultMapCenter.
CENTER_LAT=33.4152
CENTER_LNG=-111.8315

TAGS=("marshal" "dj-bike" "" "" "")
RIDER_COUNT=12
SPECTATOR_COUNT=3

run_sql() {
  psql -A -t -q "$LOCAL_DB_URL" -c "$1"
}

echo "── Checking local Supabase is up ──"
if ! curl -sf "$LOCAL_API_URL/auth/v1/health" >/dev/null; then
  echo "Error: local Supabase API not reachable at $LOCAL_API_URL. Run 'supabase start' first." >&2
  exit 1
fi

echo "── Creating a throwaway demo admin account ──"
DEMO_EMAIL="demo-seed-$(date +%s)@example.local"
ADMIN_RESPONSE=$(curl -sS -X POST "$LOCAL_API_URL/auth/v1/admin/users" \
  -H "apikey: $LOCAL_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $LOCAL_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$(uuidgen)\",\"email_confirm\":true}")
ADMIN_ID=$(echo "$ADMIN_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
run_sql "insert into admin_roles (user_id) values ('$ADMIN_ID');" >/dev/null

echo "── Creating the demo ride ──"
RIDE_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
SLUG="demo$(date +%s)"
RIDE_NAME="Demo Ride ($(date +%Y-%m-%d))"
run_sql "insert into rides (id, name, status, created_by, slug, started_at)
         values ('$RIDE_ID', '$RIDE_NAME', 'active', '$ADMIN_ID', '$SLUG', now());" >/dev/null

echo "── Seeding $RIDER_COUNT riders + $SPECTATOR_COUNT spectators scattered around Mesa, AZ ──"
for i in $(seq 1 "$RIDER_COUNT"); do
  # Small random offset, +/- ~0.01 degrees (roughly +/- 1km), so riders
  # look plausibly spread along a route instead of stacked on one point.
  LAT_OFFSET=$(python3 -c "import random; print(random.uniform(-0.01, 0.01))")
  LNG_OFFSET=$(python3 -c "import random; print(random.uniform(-0.01, 0.01))")
  TAG="${TAGS[$((RANDOM % ${#TAGS[@]}))]}"
  TAG_SQL="null"
  [[ -n "$TAG" ]] && TAG_SQL="'$TAG'"
  run_sql "insert into ride_participants (ride_id, is_spectator, tag, lat, lng, accuracy_m, heading_deg, speed_mps)
           values ('$RIDE_ID', false, $TAG_SQL, $CENTER_LAT + $LAT_OFFSET, $CENTER_LNG + $LNG_OFFSET, 8, $((RANDOM % 360)), 4.5);" >/dev/null
done
for i in $(seq 1 "$SPECTATOR_COUNT"); do
  run_sql "insert into ride_participants (ride_id, is_spectator, tag)
           values ('$RIDE_ID', true, null);" >/dev/null
done

echo
echo "── Done ──"
echo "Ride: $RIDE_NAME"
echo "Join link (local dev): http://localhost:5173/?ride=$SLUG"
echo "Admin login: $DEMO_EMAIL (password was randomly generated and discarded, this account only exists to satisfy rides.created_by)"
echo
echo "To remove this demo ride and its throwaway admin later:"
echo "  psql \"$LOCAL_DB_URL\" -c \"delete from rides where id = '$RIDE_ID';\""
echo "  psql \"$LOCAL_DB_URL\" -c \"delete from admin_roles where user_id = '$ADMIN_ID';\""
