-- Migration 007 — Drop the mocked, always-empty categorisation arrays (Sub-project B1)
-- Spec: docs/superpowers/specs/2026-07-17-B-analysis-integration-design.md §4
-- These five TEXT[] columns were never populated (0 non-empty rows across the catalogue);
-- the real qualitative coding lives in song_lyric_analysis. Self-guards before dropping.

DO $$
DECLARE
  bad integer;
BEGIN
  SELECT COUNT(*) INTO bad FROM songs WHERE
       (vegan_focus         IS NOT NULL AND array_length(vegan_focus, 1)         > 0)
    OR (animal_category      IS NOT NULL AND array_length(animal_category, 1)      > 0)
    OR (advocacy_style       IS NOT NULL AND array_length(advocacy_style, 1)       > 0)
    OR (advocacy_issues      IS NOT NULL AND array_length(advocacy_issues, 1)      > 0)
    OR (lyrical_explicitness IS NOT NULL AND array_length(lyrical_explicitness, 1) > 0);
  IF bad > 0 THEN
    RAISE EXCEPTION 'Aborting 007: % song(s) have non-empty mock categorisation — investigate before dropping', bad;
  END IF;
END $$;

-- The legacy view songs_with_manual_categories (manual_additions_schema.sql) COALESCEs these
-- columns with the 0-row manual_categorizations table; the whole manual-categorisation design is
-- abandoned (0 dependents, no app-code refs). Drop it first or the column drops fail.
DROP VIEW IF EXISTS songs_with_manual_categories;

ALTER TABLE songs DROP COLUMN IF EXISTS vegan_focus;
ALTER TABLE songs DROP COLUMN IF EXISTS animal_category;
ALTER TABLE songs DROP COLUMN IF EXISTS advocacy_style;
ALTER TABLE songs DROP COLUMN IF EXISTS advocacy_issues;
ALTER TABLE songs DROP COLUMN IF EXISTS lyrical_explicitness;
