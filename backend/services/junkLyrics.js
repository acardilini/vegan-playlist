// Junk-lyrics flag maintenance (sub-project G). Writes ONLY song_lyrics.junk_kind / junk_dismissed.
// The one place lyric text is read for admin display is listJunk, which truncates server-side.
const { classify } = require('./lyricsQuality');

// Re-check every non-dismissed, non-blank lyric (optionally only `songIds` — tests MUST pass it). Idempotent.
// flagged = rows newly flagged or changed kind; cleared = rows whose flag was removed.
// A BLANK row keeps its flag on purpose: the curator cleared junk text, and the analysis built from it must stay
// hidden until real lyrics are saved (recheck then decides). Blank rows are also left out of the Junk queue.
async function scan(db, { songIds } = {}) {
  const ids = Array.isArray(songIds) ? songIds : null;
  const rows = (await db.query(
    `SELECT song_id, lyrics, junk_kind FROM song_lyrics
     WHERE junk_dismissed = false AND btrim(lyrics) <> '' AND ($1::int[] IS NULL OR song_id = ANY($1))`, [ids])).rows;
  let flagged = 0, cleared = 0;
  for (const r of rows) {
    const kind = classify(r.lyrics);
    if (kind === r.junk_kind) continue;
    await db.query('UPDATE song_lyrics SET junk_kind=$2 WHERE song_id=$1', [r.song_id, kind]);
    if (kind) flagged++; else cleared++;
  }
  return { scanned: rows.length, flagged, cleared };
}

async function listJunk(db) {
  return (await db.query(
    `SELECT s.id, s.title, s.status, s.published, sl.junk_kind,
            COALESCE((SELECT string_agg(a.name, ', ' ORDER BY sa.id)
                      FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
                      WHERE sa.song_id = s.id), '') AS artists,
            left(regexp_replace(btrim(sl.lyrics), '\s+', ' ', 'g'), 120) AS snippet,
            EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id) AS has_analysis
     FROM song_lyrics sl JOIN songs s ON s.id = sl.song_id
     WHERE sl.junk_kind IS NOT NULL AND btrim(sl.lyrics) <> ''
     ORDER BY s.id`)).rows;
}

async function dismiss(db, songId) {
  const r = await db.query(
    'UPDATE song_lyrics SET junk_kind=NULL, junk_dismissed=true WHERE song_id=$1 RETURNING song_id', [songId]);
  if (r.rows.length === 0) { const e = new Error('no lyrics for that song'); e.code = 'NOT_FOUND'; throw e; }
}

// After the lyrics TEXT changed: new text gets a fresh look, so an earlier dismissal no longer applies.
async function recheck(db, songId) {
  const r = (await db.query('SELECT lyrics FROM song_lyrics WHERE song_id=$1', [songId])).rows[0];
  if (!r || !r.lyrics || !r.lyrics.trim()) return;   // cleared text: keep the flag (see scan)
  await db.query('UPDATE song_lyrics SET junk_dismissed=false, junk_kind=$2 WHERE song_id=$1', [songId, classify(r.lyrics)]);
}

module.exports = { scan, listJunk, dismiss, recheck };
