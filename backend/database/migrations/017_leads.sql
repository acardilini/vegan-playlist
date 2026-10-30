-- 017 - leads. A band the curator wants to look into later: captured in seconds (name, optional note/song/link) and
-- reminded about in the admin Leads tab. Never public. artist_id points at the artist a lead was promoted to; deleting
-- that artist leaves the lead intact. Additive, idempotent.
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  note TEXT,
  song TEXT,
  url TEXT,
  origin TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'checked', 'dismissed')),
  dismissed_at TIMESTAMP,
  artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS leads_name_key_idx ON leads(name_key);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);
