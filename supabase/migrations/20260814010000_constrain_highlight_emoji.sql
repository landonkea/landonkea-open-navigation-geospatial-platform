-- Defense-in-depth companion to the escapeHtml() fix in main.ts (found
-- in code review): ride_highlights.emoji had no length constraint at
-- all, unlike message's char_length check, even though the INSERT
-- policy is `with check (true)` the same as every other write in this
-- schema, so anything postable via the REST API directly (not just
-- through the app's own curated-emoji picker) landed here unconstrained.
-- Client-side escaping is the real fix (a short malicious string is
-- still just as escaped as a long one), this only bounds how much
-- junk a single row can hold, matching message's existing pattern.
alter table public.ride_highlights add constraint ride_highlights_emoji_length check (char_length(emoji) <= 8);
