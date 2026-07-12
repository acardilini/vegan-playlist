// Curation-workbench service. Functions take `db` (pool or client) first for testability.
// Mirrors services/staging.js conventions.
const DEFAULT_MODEL = 'gemma4:latest';
const PARK_REASONS = ['awaiting_community', 'needs_transcription', 'listened_unclear'];

async function getProcessing(db, songId) {
  const r = await db.query(
    `SELECT song_id, snooze_until, park_reason, lyrics_tried, processing_note
     FROM song_processing WHERE song_id=$1`, [songId]);
  return r.rows[0] || { song_id: songId, snooze_until: null, park_reason: null, lyrics_tried: [], processing_note: null };
}

async function setProcessing(db, songId, { snooze_until, park_reason, lyrics_tried, processing_note } = {}) {
  if ((await db.query('SELECT 1 FROM songs WHERE id=$1', [songId])).rows.length === 0) {
    const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
  }
  if (park_reason != null && park_reason !== '' && !PARK_REASONS.includes(park_reason)) {
    const e = new Error('invalid park_reason'); e.code = 'BAD_INPUT'; throw e;
  }
  const tried = lyrics_tried === undefined ? null : JSON.stringify(Array.isArray(lyrics_tried) ? lyrics_tried : []);
  const r = await db.query(`
    INSERT INTO song_processing (song_id, snooze_until, park_reason, lyrics_tried, processing_note, updated_at)
    VALUES ($1,$2,$3,COALESCE($4::jsonb,'[]'::jsonb),$5,CURRENT_TIMESTAMP)
    ON CONFLICT (song_id) DO UPDATE SET
      snooze_until    = EXCLUDED.snooze_until,
      park_reason     = EXCLUDED.park_reason,
      lyrics_tried    = COALESCE($4::jsonb, song_processing.lyrics_tried),
      processing_note = EXCLUDED.processing_note,
      updated_at      = CURRENT_TIMESTAMP
    RETURNING song_id, snooze_until, park_reason, lyrics_tried, processing_note`,
    [songId, snooze_until || null, (park_reason || null), tried, (processing_note ?? null)]);
  return r.rows[0];
}

module.exports = { DEFAULT_MODEL, PARK_REASONS, getProcessing, setProcessing };
