-- 026 - artist merges (piece 3). One row per merge: the loser's artist row, its song links, members and lead ids as
-- they were just before the merge, so a wrong merge can be rebuilt by hand. Web-owned, admin-only, additive.
-- Deliberately NO foreign keys: the loser artist is deleted by the merge, and the keeper may itself be merged away later.
CREATE TABLE IF NOT EXISTS artist_merges (
  id              SERIAL PRIMARY KEY,
  loser_id        INTEGER NOT NULL,
  keeper_id       INTEGER NOT NULL,
  loser_snapshot  JSONB NOT NULL,
  merged_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS artist_merges_keeper_idx ON artist_merges(keeper_id);
