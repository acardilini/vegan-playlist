// Staging-queue service. Functions take `db` (pool or client) first for testability.
const { getSpotifyClient, withRetry, fetchPlaylistTracks,
        addTracksAsPending, upsertAlbum, upsertArtist } = require('../utils/playlistSync');

function normalizeName(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '').replace(/ - .*/, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const ARTWORK_SQL = `(al.images IS NOT NULL AND al.images::text NOT IN ('null','[]',''))`;

async function listQueue(db, { queue, q = '', limit = null, offset = 0 } = {}) {
  let where;
  const params = [];
  if (queue === 'pending') where = `s.status = 'pending'`;
  else if (queue === 'to-finalise') where = `s.status = 'included' AND s.published = false`;
  else if (queue === 'live') {
    if (!q || !q.trim()) { const e = new Error('search term required for live queue'); e.code = 'Q_REQUIRED'; throw e; }
    where = `s.status = 'included' AND s.published = true`;
    params.push(`%${q.trim()}%`);
    where += ` AND (s.title ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM song_artists sa2 JOIN artists a2 ON a2.id = sa2.artist_id
      WHERE sa2.song_id = s.id AND a2.name ILIKE $${params.length}))`;
  } else { const e = new Error('unknown queue'); e.code = 'BAD_QUEUE'; throw e; }

  let sql = `
    SELECT s.id, s.title, s.status, s.published,
           s.spotify_url, s.bandcamp_url, s.soundcloud_url,
           ${ARTWORK_SQL} AS has_art,
           COALESCE(string_agg(DISTINCT a.name, ', '), '') AS artists,
           EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id) AS has_youtube
    FROM songs s
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    WHERE ${where}
    GROUP BY s.id, al.images
    ORDER BY s.id`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; params.push(offset); sql += ` OFFSET $${params.length}`; }

  const rows = (await db.query(sql, params)).rows.map(r => {
    const kinds = [];
    if (r.spotify_url) kinds.push('spotify');
    if (r.bandcamp_url) kinds.push('bandcamp');
    if (r.soundcloud_url) kinds.push('soundcloud');
    if (r.has_youtube) kinds.push('youtube');
    const has_play_link = kinds.length > 0;
    const out = {
      id: r.id, title: r.title, artists: r.artists, status: r.status, published: r.published,
      has_art: r.has_art, has_play_link, play_link_kinds: kinds,
    };
    if (queue === 'to-finalise') {
      const missing = [];
      if (!has_play_link) missing.push('play link');
      if (!r.has_art) missing.push('artwork');
      out.missing = missing;
    }
    return out;
  });
  return { queue, total: rows.length, rows };
}

async function includeSong(db, id, { publish = false } = {}) {
  const sql = publish
    ? `UPDATE songs SET status='included', published=true, published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 RETURNING id, title, status, published`
    : `UPDATE songs SET status='included', updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 RETURNING id, title, status, published`;
  const r = await db.query(sql, [id]);
  if (r.rows.length === 0) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}

async function rejectSong(db, id) {
  const r = await db.query(
    `UPDATE songs SET status='rejected', published=false, published_at=NULL, updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING id, title, status, published`, [id]);
  if (r.rows.length === 0) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}

module.exports = { normalizeName, listQueue, includeSong, rejectSong };
