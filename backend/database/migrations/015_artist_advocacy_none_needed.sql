-- 015 - artists area (sub-project I1). The curator can mark an artist "no advocacy notes needed" so it
-- can leave the Needs advocacy notes queue without inventing text. Additive, idempotent.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS no_advocacy_notes_needed BOOLEAN NOT NULL DEFAULT false;
