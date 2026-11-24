-- 025 - artist enrichment review (piece 2). Web-owned: the curator's decisions about the analysis project's staged
-- artist proposals. The staging tables themselves (artist_enrichment_proposals, ...) belong to the analysis project and are only read.
-- Additive; no backfill.
--   artist_enrichment_review: one row per artist. match_decision records whether the curator approved or rejected the
--   proposed MusicBrainz match, and matched_mbid is the id that decision was about (both set or both NULL).
--   finished_at marks the artist as fully reviewed.
CREATE TABLE IF NOT EXISTS artist_enrichment_review (
  artist_id      INTEGER PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
  match_decision TEXT CHECK (match_decision IN ('approved', 'rejected')),
  matched_mbid   UUID,
  finished_at    TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((match_decision IS NULL) = (matched_mbid IS NULL))
);

-- A MusicBrainz id identifies one band, so no two artists may hold the same one. Refuse clearly (rather than with a bare
-- index error) if the data already has duplicates; resolve them by hand, then re-run.
DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg(musicbrainz_id::text || ' (artists ' || ids || ')', '; ') INTO dupes
  FROM (
    SELECT musicbrainz_id, string_agg(id::text, ', ' ORDER BY id) AS ids
    FROM artists
    WHERE musicbrainz_id IS NOT NULL
    GROUP BY musicbrainz_id
    HAVING COUNT(*) > 1
  ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add the unique MusicBrainz index: duplicate musicbrainz_id values exist: %', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS artists_musicbrainz_id_unique ON artists (musicbrainz_id) WHERE musicbrainz_id IS NOT NULL;
