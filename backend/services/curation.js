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

const ARTWORK_SQL = `(al.images IS NOT NULL AND al.images::text NOT IN ('null','[]',''))`;
const MODEL_LITERAL = `'${DEFAULT_MODEL.replace(/'/g, "''")}'`; // controlled constant, safe to inline
const QUEUE_NAMES = ['to-process','awaiting-community','remind-later','needs-lyrics',
  'needs-cover','needs-video','needs-analysis','to-finalise','live','all'];

function queueWhere(queue) {
  switch (queue) {
    case 'to-process':
      return `s.status='pending'
              AND sp.park_reason IS DISTINCT FROM 'awaiting_community'
              AND (sp.snooze_until IS NULL OR sp.snooze_until <= CURRENT_DATE)`;
    case 'awaiting-community':
      return `s.status='pending' AND sp.park_reason='awaiting_community'`;
    case 'remind-later':
      return `sp.snooze_until IS NOT NULL AND sp.snooze_until > CURRENT_DATE`;
    case 'needs-lyrics':
      return `s.status='included' AND NOT EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id)`;
    case 'needs-cover':
      return `s.status='included' AND NOT ${ARTWORK_SQL}`;
    case 'needs-video':
      return `s.status='included' AND NOT EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id=s.id)`;
    case 'needs-analysis':
      return `s.status='included'
              AND EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id)
              AND NOT EXISTS (SELECT 1 FROM song_lyric_analysis sa
                              WHERE sa.song_id=s.id AND sa.model_used=${MODEL_LITERAL})`;
    case 'to-finalise':
      return `s.status='included' AND s.published=false`;
    case 'live':
      return `s.status='included' AND s.published=true`;
    case 'all':
      return `TRUE`;
    default: { const e = new Error('unknown queue'); e.code = 'BAD_QUEUE'; throw e; }
  }
}

function mapQueueRow(r) {
  const kinds = [];
  if (r.spotify_url) kinds.push('spotify');
  if (r.bandcamp_url) kinds.push('bandcamp');
  if (r.soundcloud_url) kinds.push('soundcloud');
  if (r.has_youtube) kinds.push('youtube');
  const has_play_link = kinds.length > 0;
  const missing = [];
  if (!r.has_lyrics) missing.push('lyrics');
  if (!r.has_art) missing.push('cover');
  if (!r.has_youtube) missing.push('video');
  if (!has_play_link) missing.push('play link');
  return {
    id: r.id, title: r.title, artists: r.artists, status: r.status, published: r.published,
    language: r.language, has_art: r.has_art, has_lyrics: r.has_lyrics, has_youtube: r.has_youtube,
    has_play_link, play_link_kinds: kinds, snooze_until: r.snooze_until, park_reason: r.park_reason, missing,
  };
}

async function listCurationQueue(db, { queue, q = '', limit = null, offset = 0 } = {}) {
  const where = queueWhere(queue);
  const params = [];
  let searchClause = '';
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    searchClause = ` AND (s.title ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM song_artists sa2 JOIN artists a2 ON a2.id=sa2.artist_id
      WHERE sa2.song_id=s.id AND a2.name ILIKE $${params.length}))`;
  }
  let sql = `
    SELECT s.id, s.title, s.status, s.published, s.language,
           s.spotify_url, s.bandcamp_url, s.soundcloud_url,
           ${ARTWORK_SQL} AS has_art,
           COALESCE(string_agg(DISTINCT a.name, ', '), '') AS artists,
           EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id=s.id) AS has_youtube,
           EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id) AS has_lyrics,
           sp.snooze_until, sp.park_reason
    FROM songs s
    LEFT JOIN albums al ON al.id=s.album_id
    LEFT JOIN song_processing sp ON sp.song_id=s.id
    LEFT JOIN song_artists sa ON sa.song_id=s.id
    LEFT JOIN artists a ON a.id=sa.artist_id
    WHERE (${where})${searchClause}
    GROUP BY s.id, al.images, sp.snooze_until, sp.park_reason
    ORDER BY s.id`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; params.push(offset); sql += ` OFFSET $${params.length}`; }
  const rows = (await db.query(sql, params)).rows.map(mapQueueRow);
  return { queue, total: rows.length, rows };
}

async function queueCounts(db) {
  const keys = ['to-process','awaiting-community','remind-later','needs-lyrics',
    'needs-cover','needs-video','needs-analysis','to-finalise'];
  const out = {};
  for (const queue of keys) {
    const r = await db.query(`
      SELECT COUNT(*)::int AS n FROM songs s
      LEFT JOIN albums al ON al.id=s.album_id
      LEFT JOIN song_processing sp ON sp.song_id=s.id
      WHERE (${queueWhere(queue)})`);
    out[queue] = r.rows[0].n;
  }
  // inbox = community submissions not yet bridged to a song (list/moderation is sub-project C)
  out.inbox = (await db.query(`SELECT COUNT(*)::int AS n FROM song_submissions WHERE existing_song_id IS NULL`)).rows[0].n;
  return out;
}

module.exports = { DEFAULT_MODEL, PARK_REASONS, QUEUE_NAMES,
  getProcessing, setProcessing, listCurationQueue, queueCounts };
