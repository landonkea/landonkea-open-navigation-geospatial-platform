-- ── Add last_moved_at, powers "possibly stuck" detection ───────────
-- WHAT: a timestamp updated only when a participant's position has
-- meaningfully changed (see src/core/policy.ts's
-- STUCK_DETECTION_MAX_DISTANCE_METERS), left untouched while they
-- stay in roughly the same spot. The gap between this and now is what
-- flags a rider as possibly stuck/broken down on the trail, distinct
-- from the existing green/yellow/red signal-status logic, which is
-- about connection quality, not movement, a rider can have perfect
-- signal while genuinely stopped.
--
-- WHY NOT a full position-history table instead: this app already
-- deliberately avoids storing a live history (see ride_history_samples,
-- which only samples once retention kicks in after a ride ends), one
-- extra timestamp column is a much smaller, simpler way to answer
-- "how long has this rider been stationary" than querying a history
-- table on every check.
alter table ride_participants
  add column last_moved_at timestamptz not null default now();
