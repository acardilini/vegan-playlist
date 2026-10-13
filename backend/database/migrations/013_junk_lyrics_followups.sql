-- 013 — junk-lyrics follow-ups (sub-project G).
--  * analysis_stale_since: set when REAL lyrics replace flagged junk. Analysis passes older than this were coded from the
--    junk and stay hidden until the analysis project writes a newer pass (services/analysis.js NOT_JUNK).
--  * junk_dismissed_md5: md5 of the lyrics text the curator confirmed with "Not junk"; if the text later changes
--    out-of-band, scan re-checks it instead of trusting the old dismissal.
-- Additive, idempotent.
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS analysis_stale_since TIMESTAMP;
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS junk_dismissed_md5 TEXT;
UPDATE song_lyrics SET junk_dismissed_md5 = md5(lyrics) WHERE junk_dismissed AND junk_dismissed_md5 IS NULL;
