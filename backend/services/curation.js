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
    'needs-cover','needs-video','needs-analysis','to-finalise','live'];
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

async function catalogueStats(db) {
  const r = await db.query(`
    SELECT
      COUNT(*)::int                                                     AS total,
      COUNT(*) FILTER (WHERE status='included' AND published=true)::int  AS live,
      COUNT(*) FILTER (WHERE status='included' AND published=false)::int AS to_finalise,
      COUNT(*) FILTER (WHERE status='pending')::int                      AS pending,
      COUNT(*) FILTER (WHERE status='rejected')::int                     AS rejected
    FROM songs`);
  const x = r.rows[0];
  return { total: x.total, live: x.live, toFinalise: x.to_finalise, pending: x.pending, rejected: x.rejected };
}

async function recentlyEdited(db, limit = 10) {
  const parsed = parseInt(limit, 10);
  // isNaN (not `parsed || 10`) so an explicit limit=0 clamps to 1, not the default 10.
  const n = isNaN(parsed) ? 10 : Math.min(Math.max(1, parsed), 50);
  return (await db.query(`
    SELECT s.id, s.title, s.status, s.published, s.updated_at,
           COALESCE(string_agg(DISTINCT a.name, ', '), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id=s.id
    LEFT JOIN artists a ON a.id=sa.artist_id
    GROUP BY s.id
    ORDER BY s.updated_at DESC NULLS LAST, s.id DESC
    LIMIT $1`, [n])).rows;
}

function hasArt(images) {
  return !!(images && !['null', '[]', ''].includes(String(images).trim()));
}

async function getWorkbench(db, id) {
  const s = (await db.query(`
    SELECT s.*, al.name AS album_name, al.images AS album_images, al.release_date AS album_release_date
    FROM songs s LEFT JOIN albums al ON al.id=s.album_id WHERE s.id=$1`, [id])).rows[0];
  if (!s) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }

  const artists = (await db.query(
    `SELECT a.id, a.name, a.website_url FROM song_artists sa JOIN artists a ON a.id=sa.artist_id
     WHERE sa.song_id=$1 ORDER BY a.name`, [id])).rows;
  const videos = (await db.query(
    `SELECT id, youtube_id, video_title, video_type, is_primary FROM youtube_videos
     WHERE song_id=$1 ORDER BY is_primary DESC, id`, [id])).rows;
  const lyricsRow = (await db.query(
    `SELECT lyrics, source_url, translation FROM song_lyrics WHERE song_id=$1`, [id])).rows[0] || null;
  const processing = await getProcessing(db, id);
  const analysed = (await db.query(
    `SELECT 1 FROM song_lyric_analysis WHERE song_id=$1 AND model_used=$2`, [id, DEFAULT_MODEL])).rows.length > 0;

  const cover = hasArt(s.album_images);
  const play_link = !!(s.spotify_url || s.bandcamp_url || s.soundcloud_url || videos.length > 0);
  return {
    id: s.id, title: s.title, status: s.status, published: s.published, language: s.language,
    spotify_id: s.spotify_id, spotify_url: s.spotify_url, bandcamp_url: s.bandcamp_url, soundcloud_url: s.soundcloud_url,
    lyrics_status: s.lyrics_status, lyrics_url: s.lyrics_url, lyrics_source: s.lyrics_source,
    lyrics_highlights: s.lyrics_highlights, status_notes: s.status_notes,
    album: { name: s.album_name, images: s.album_images, release_date: s.album_release_date },
    artists, videos,
    lyrics: lyricsRow ? lyricsRow.lyrics : null,
    lyrics_source_url: lyricsRow ? lyricsRow.source_url : null,
    translation: lyricsRow ? lyricsRow.translation : null,
    processing, analysed,
    completeness: { lyrics: !!lyricsRow, cover, video: videos.length > 0, play_link, analysis: analysed },
  };
}

const LYRICS_STATUSES = ['found', 'not_found', 'not_searched'];

async function assertSong(db, id) {
  if ((await db.query('SELECT 1 FROM songs WHERE id=$1', [id])).rows.length === 0) {
    const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
  }
}
function assertHttp(v, label) {
  if (v != null && v !== '' && !/^https?:\/\//i.test(v)) {
    const e = new Error(`${label} must be an http(s) URL`); e.code = 'BAD_INPUT'; throw e;
  }
}

async function saveDetails(db, id, { title, language, status_notes } = {}) {
  await assertSong(db, id);
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('title', title); add('language', language); add('status_notes', status_notes);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}

async function saveLyrics(db, id, { lyrics, source_url, translation, lyrics_status, lyrics_url, lyrics_source } = {}) {
  await assertSong(db, id);
  if (lyrics_status != null && !LYRICS_STATUSES.includes(lyrics_status)) {
    const e = new Error('invalid lyrics_status'); e.code = 'BAD_INPUT'; throw e;
  }
  if (lyrics !== undefined) {
    if (lyrics == null || lyrics === '') {
      await db.query('DELETE FROM song_lyrics WHERE song_id=$1', [id]);
    } else {
      await db.query(`
        INSERT INTO song_lyrics (song_id, lyrics, source_url, translation)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (song_id) DO UPDATE SET
          lyrics=EXCLUDED.lyrics, source_url=EXCLUDED.source_url, translation=EXCLUDED.translation`,
        [id, lyrics, source_url || null, translation || null]);
    }
  } else if (translation !== undefined || source_url !== undefined) {
    await db.query(`
      UPDATE song_lyrics SET
        translation = COALESCE($2, translation),
        source_url  = COALESCE($3, source_url)
      WHERE song_id=$1`,
      [id, translation === undefined ? null : translation, source_url === undefined ? null : source_url]);
  }
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('lyrics_status', lyrics_status); add('lyrics_url', lyrics_url); add('lyrics_source', lyrics_source);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}

async function saveHighlights(db, id, { lyrics_highlights } = {}) {
  await assertSong(db, id);
  await db.query(`UPDATE songs SET lyrics_highlights=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [id, lyrics_highlights || null]);
  return getWorkbench(db, id);
}

async function saveLinks(db, id, { spotify_url, bandcamp_url, soundcloud_url } = {}) {
  await assertSong(db, id);
  assertHttp(spotify_url, 'spotify_url'); assertHttp(bandcamp_url, 'bandcamp_url'); assertHttp(soundcloud_url, 'soundcloud_url');
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('spotify_url', spotify_url); add('bandcamp_url', bandcamp_url); add('soundcloud_url', soundcloud_url);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}

async function setCover(db, id, { cover_url } = {}) {
  await assertSong(db, id);
  if (!cover_url || !/^https?:\/\//i.test(cover_url)) {
    const e = new Error('cover_url must be an http(s) URL'); e.code = 'BAD_INPUT'; throw e;
  }
  const images = JSON.stringify([{ url: cover_url }]);
  const song = (await db.query('SELECT album_id, title FROM songs WHERE id=$1', [id])).rows[0];
  if (song.album_id) {
    await db.query('UPDATE albums SET images=$2 WHERE id=$1', [song.album_id, images]);
  } else {
    const album = (await db.query(
      `INSERT INTO albums (name, images, data_source) VALUES ($1, $2, 'manual') RETURNING id`,
      [song.title || 'Untitled', images])).rows[0];
    await db.query('UPDATE songs SET album_id=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [id, album.id]);
  }
  return getWorkbench(db, id);
}

async function quickCapture(db, { title, artist } = {}) {
  const t = (title || '').trim();
  const a = (artist || '').trim();
  if (!t || !a) { const e = new Error('title and artist are required'); e.code = 'BAD_INPUT'; throw e; }
  const song = (await db.query(
    `INSERT INTO songs (title, status, published, data_source, created_at)
     VALUES ($1, 'pending', false, 'manual', CURRENT_TIMESTAMP) RETURNING id`, [t])).rows[0];
  let art = (await db.query(
    `SELECT id FROM artists WHERE LOWER(name)=LOWER($1) AND data_source='manual'`, [a])).rows[0];
  if (!art) {
    art = (await db.query(
      `INSERT INTO artists (name, data_source, created_at) VALUES ($1,'manual',CURRENT_TIMESTAMP) RETURNING id`, [a])).rows[0];
  }
  await db.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [song.id, art.id]);
  return { id: song.id };
}

module.exports = { DEFAULT_MODEL, PARK_REASONS, QUEUE_NAMES, LYRICS_STATUSES,
  getProcessing, setProcessing, listCurationQueue, queueCounts, catalogueStats, recentlyEdited, getWorkbench, hasArt,
  saveDetails, saveLyrics, saveHighlights, saveLinks, setCover, quickCapture };
