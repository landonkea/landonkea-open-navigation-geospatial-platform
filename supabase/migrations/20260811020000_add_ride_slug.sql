-- ── Short, date-based join links ────────────────────────────────────
-- WHAT: adds a short `slug` column to `rides` (format MMDDYYYY, e.g.
-- "08112026") so join links/QR codes can be short and human-typeable
-- instead of a long UUID.
--
-- HONEST SECURITY TRADEOFF, worth stating plainly (same spirit as this
-- schema's original top comment about the UUID-as-join-secret design):
-- a date is trivially guessable, unlike the random UUID this schema
-- was originally built around. Anyone who thinks to type in today's
-- date can find a live ride happening that day. This is a real,
-- meaningful weakening of the original "unguessable link" privacy
-- model, accepted here as a deliberate, explicit tradeoff for a much
-- shorter, easier-to-share/print link, not an oversight.
alter table rides add column slug text unique;

-- Existing rows (if any) get no slug, that's fine, they're only
-- reachable by their original UUID-based link.
