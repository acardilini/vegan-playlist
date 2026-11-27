-- 030 - a band member's role (free text such as "Vocals" or "Guitar, backing vocals"), shown in the artist workbench members
-- table. Optional, trimmed and capped at 80 characters by services/artistFacts.js (the single writer); NULL = not stated.
-- MusicBrainz can propose a role (fills an empty one only, never overwrites). Not shown on the public site.
-- Additive and idempotent.
ALTER TABLE artist_members ADD COLUMN IF NOT EXISTS role TEXT;
