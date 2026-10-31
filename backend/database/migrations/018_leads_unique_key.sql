-- 018 - one lead per band name key, so two quick captures of the same band cannot both insert. Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS leads_name_key_uniq ON leads(name_key);
