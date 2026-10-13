// Junk-lyrics flag maintenance (sub-project G). Writes ONLY song_lyrics.junk_kind / junk_dismissed.
// The one place lyric text is read for admin display is listJunk, which truncates server-side.
const { classify } = require('./lyricsQuality');

// Re-check every non-blank lyric that is not a *current* dismissal (optionally only `songIds` — tests MUST pass it).
// A dismissal covers the exact text the curator confirmed (junk_dismissed_md5); if the text changed since, it is
// re-checked. Idempotent. flagged = rows newly flagged or changed kind; cleared = rows whose flag was removed
// (real text over a flagged row also starts the "analysis stale" clock, see recheck).
// A BLANK row keeps its flag on purpose: the curator cleared junk text, and the analysis built from it must stay
// hidden until real lyrics are saved (recheck then decides). Blank rows are also left out of the Junk queue.
async function scan(db, { songIds } = {}) {
  const ids = Array.isArray(songIds) ? songIds : null;
  const rows = (await db.query(
    `SELECT song_id, lyrics, junk_kind, junk_dismissed FROM song_lyrics
     WHERE btrim(lyrics) <> '' AND ($1::int[] IS NULL OR song_id = ANY($1))
       AND (junk_dismissed = false OR junk_dismissed_md5 IS DISTINCT FROM md5(lyrics))`, [ids])).rows;
  let flagged = 0, cleared = 0;
  for (const r of rows) {
    const kind = classify(r.lyrics);
    if (kind === r.junk_kind && !r.junk_dismissed) continue;
    await db.query(
      `UPDATE song_lyrics SET junk_kind=$2, junk_dismissed=false, junk_dismissed_md5=NULL,
              analysis_stale_since = CASE WHEN $3::boolean THEN CURRENT_TIMESTAMP ELSE analysis_stale_since END
        WHERE song_id=$1`, [r.song_id, kind, r.junk_kind !== null && kind === null]);
    if (kind) flagged++; else if (r.junk_kind) cleared++;
  }
  return { scanned: rows.length, flagged, cleared };
}

async function listJunk(db, { limit = 100, offset = 0 } = {}) {
  return (await db.query(
    `SELECT s.id, s.title, s.status, s.published, sl.junk_kind,
            COALESCE((SELECT string_agg(a.name, ', ' ORDER BY sa.id)
                      FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
                      WHERE sa.song_id = s.id), '') AS artists,
            left(regexp_replace(btrim(sl.lyrics), '\s+', ' ', 'g'), 120) AS snippet,
            EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id) AS has_analysis
     FROM song_lyrics sl JOIN songs s ON s.id = sl.song_id
     WHERE sl.junk_kind IS NOT NULL AND btrim(sl.lyrics) <> ''
     ORDER BY s.id
     LIMIT $1 OFFSET $2`, [limit, offset])).rows;
}

async function dismiss(db, songId) {
  const r = await db.query(
    'UPDATE song_lyrics SET junk_kind=NULL, junk_dismissed=true, junk_dismissed_md5=md5(lyrics) WHERE song_id=$1 RETURNING song_id', [songId]);
  if (r.rows.length === 0) { const e = new Error('no lyrics for that song'); e.code = 'NOT_FOUND'; throw e; }
}

// After the lyrics TEXT changed: new text gets a fresh look, so an earlier dismissal no longer applies. Real text
// replacing a flagged OR cleared (blank) row starts the analysis-stale clock: passes coded from the old text stay
// hidden until re-analysed. `wasBlank` = the row's text was blank before this save (the caller reads it).
async function recheck(db, songId, { wasBlank = false } = {}) {
  const r = (await db.query('SELECT lyrics, junk_kind FROM song_lyrics WHERE song_id=$1', [songId])).rows[0];
  if (!r || !r.lyrics || !r.lyrics.trim()) return;   // cleared text: keep the flag (see scan)
  const kind = classify(r.lyrics);
  await db.query(
    `UPDATE song_lyrics SET junk_dismissed=false, junk_dismissed_md5=NULL, junk_kind=$2,
            analysis_stale_since = CASE WHEN $3::boolean THEN CURRENT_TIMESTAMP ELSE analysis_stale_since END
      WHERE song_id=$1`, [songId, kind, (r.junk_kind !== null || wasBlank) && kind === null]);
}

module.exports = { scan, listJunk, dismiss, recheck };
