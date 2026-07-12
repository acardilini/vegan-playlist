-- Migration 006 — Curation workbench foundation (Sub-project A1)
-- Spec: docs/superpowers/specs/2026-07-12-admin-workbench-design.md §3
-- Additive only.

-- Non-derivable per-song curation workflow state (kept off the fat songs table).
CREATE TABLE IF NOT EXISTS song_processing (
  song_id         INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  snooze_until    DATE,                       -- "remind me later"; NULL = not snoozed
  park_reason     VARCHAR(30)
     CHECK (park_reason IS NULL OR park_reason IN
            ('awaiting_community','needs_transcription','listened_unclear')),
  lyrics_tried    JSONB NOT NULL DEFAULT '[]', -- avenues exhausted e.g. ["google","genius"]
  processing_note TEXT,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Language the song is sung in (public catalogue metadata).
ALTER TABLE songs ADD COLUMN IF NOT EXISTS language VARCHAR(40);

-- Translation of the lyrics — copyright-sensitive, LOCAL ONLY (same rules as song_lyrics.lyrics).
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS translation TEXT;
