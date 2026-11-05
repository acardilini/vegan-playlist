-- 019 - thread_claims. Unconfirmed notes about who is vegan, captured from pasted Reddit threads by the thread-import skill.
-- Admin-only: never read by a public route and in no queue predicate. A lead's claims move to the artist on Promote.
-- Additive, idempotent.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS thread_claims TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS thread_claims TEXT;
