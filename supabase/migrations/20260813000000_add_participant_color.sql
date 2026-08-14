-- Optional rider-chosen color, shown as a stroke ring around their map
-- dot (src/core/map.ts), NOT the dot's fill (that stays status-driven,
-- green/yellow/red, a deliberate existing design choice, see
-- OPERATIONS.md). Lets a rider spot their own dot instantly on a
-- crowded map without changing what the fill color means. Display-only,
-- like device_hash, never used for identity/auth/RLS.
alter table ride_participants add column color text;
