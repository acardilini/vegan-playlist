-- 009 — songs.language becomes multi-valued (bilingual songs).
-- VARCHAR(40) -> text[]. Idempotent: the type change is guarded, the data fix is
-- self-limiting. regexp_split_to_array (not string_to_array) because it trims the
-- whitespace around the separator in one pass, and because ALTER ... USING forbids
-- the subquery a per-element btrim would need.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'songs' AND column_name = 'language' AND table_schema = 'public'
               AND data_type <> 'ARRAY') THEN
    ALTER TABLE songs ALTER COLUMN language TYPE text[]
      USING CASE WHEN btrim(COALESCE(language, '')) = '' THEN NULL
                 ELSE regexp_split_to_array(btrim(language), '\s*;\s*') END;
    UPDATE songs SET language = NULLIF(array_remove(language, ''), '{}')
      WHERE language IS NOT NULL;
  END IF;
END $$;

-- Data fix: 'Mouri' is a typo for 'Māori' (1 row).
UPDATE songs SET language = array_replace(language, 'Mouri', 'Māori')
  WHERE language IS NOT NULL AND 'Mouri' = ANY(language);
