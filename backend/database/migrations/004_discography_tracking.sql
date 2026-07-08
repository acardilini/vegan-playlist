-- Migration 004 — Artist discography-review tracking (catch-up, Session 2.2)
-- Documents DDL already applied to the live DB by the deleted admin route
-- POST /api/admin/setup-discography-tracking (DDL-over-HTTP, removed 2026-07-08).
-- Idempotent; running it is a no-op on the live DB.
--
-- Note: the deleted route also did ADD COLUMN IF NOT EXISTS data_source VARCHAR(50),
-- which was a no-op — artists.data_source already existed as VARCHAR(20) DEFAULT
-- 'spotify' (recorded here as the applied state; no other SQL file documents it).

ALTER TABLE artists ADD COLUMN IF NOT EXISTS discography_reviewed BOOLEAN DEFAULT false;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS discography_reviewed_date TIMESTAMP;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS discography_review_notes TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'spotify';

CREATE INDEX IF NOT EXISTS idx_artists_discography_reviewed
ON artists(discography_reviewed)
WHERE discography_reviewed = true;
