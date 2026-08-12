-- Admin-panel display label only, never used for identity/auth/RLS.
-- A stable per-device hash (userAgent+screen+timezone+language,
-- hashed client-side, see src/core/deviceHash.ts), so an admin sees
-- the same short code for the same physical device across rides
-- instead of a meaningless random participant id.
alter table ride_participants add column device_hash text;
