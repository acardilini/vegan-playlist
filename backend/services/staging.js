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

async function setPlayLink(db, id, { bandcamp_url, soundcloud_url } = {}) {
  const provided = [['bandcamp_url', bandcamp_url], ['soundcloud_url', soundcloud_url]].filter(([, v]) => v != null && v !== '');
  if (provided.length === 0) { const e = new Error('a bandcamp_url or soundcloud_url is required'); e.code = 'BAD_INPUT'; throw e; }
  for (const [, v] of provided) {
    if (!/^https?:\/\//i.test(v)) { const e = new Error('play link must be an http(s) URL'); e.code = 'BAD_INPUT'; throw e; }
  }
  const params = [id];
  const sets = provided.map(([col, v]) => { params.push(v); return `${col}=$${params.length}`; });
  const r = await db.query(
    `UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING id, title, bandcamp_url, soundcloud_url`, params);
  if (r.rows.length === 0) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}

async function insertCandidates(db, tracks) {
  const existing = (await db.query(`
    SELECT s.spotify_id, s.title, COALESCE(string_agg(a.name, ', '), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    GROUP BY s.id`)).rows;
  const existingIds = new Set(existing.filter(e => e.spotify_id).map(e => e.spotify_id));
  const existingTA = new Set(existing.map(e => normalizeName(e.title) + '|' + normalizeName(e.artists)));

  const seenIds = new Set(), seenTA = new Set(), toAdd = [];
  let skippedExisting = 0;
  for (const t of tracks) {
    const ta = normalizeName(t.title) + '|' + normalizeName((t.artists || []).map(a => a.name).join(', '));
    if ((t.spotify_id && existingIds.has(t.spotify_id)) || existingTA.has(ta) ||
        (t.spotify_id && seenIds.has(t.spotify_id)) || seenTA.has(ta)) {
      skippedExisting++; continue;
    }
    if (t.spotify_id) seenIds.add(t.spotify_id);
    seenTA.add(ta);
    toAdd.push(t);
  }
  const added = await addTracksAsPending(db, toAdd, 'added as candidate via staging intake');
  return { added, skippedExisting };
}

// 'https://open.spotify.com/track/ID', 'spotify:playlist:ID', or a bare 22-char id (assumed track)
function parseSpotifyRef(u) {
  const s = String(u).trim();
  const m = s.match(/(track|playlist)[/:]([A-Za-z0-9]{22})/);
  if (m) return { type: m[1], id: m[2] };
  if (/^[A-Za-z0-9]{22}$/.test(s)) return { type: 'track', id: s };
  return null;
}

// Shape a raw Spotify track object like fetchPlaylistTracks does (no added_at).
function mapTrack(t) {
  return {
    spotify_id: t.id, title: t.name, duration_ms: t.duration_ms, popularity: t.popularity,
    explicit: t.explicit, track_number: t.track_number, disc_number: t.disc_number,
    spotify_url: t.external_urls && t.external_urls.spotify, added_at: null,
    artists: (t.artists || []).map(a => ({ spotify_id: a.id, name: a.name, spotify_url: a.external_urls && a.external_urls.spotify })),
    album: t.album && t.album.id ? {
      spotify_id: t.album.id, name: t.album.name, images: t.album.images || [],
      release_date: t.album.release_date || null, total_tracks: t.album.total_tracks || null,
      album_type: t.album.album_type || null, spotify_url: t.album.external_urls && t.album.external_urls.spotify,
    } : null,
  };
}

async function resolveSpotifyUrls(urls) {
  const api = await getSpotifyClient();
  const refs = urls.map(parseSpotifyRef);
  const invalid = urls.filter((_, i) => !refs[i]);
  const trackIds = [], playlistIds = [];
  refs.forEach(r => { if (!r) return; (r.type === 'track' ? trackIds : playlistIds).push(r.id); });
  const tracks = [];
  for (let i = 0; i < trackIds.length; i += 50) {
    const batch = trackIds.slice(i, i + 50);
    const res = await withRetry(() => api.getTracks(batch));
    for (const t of res.body.tracks) if (t && t.id) tracks.push(mapTrack(t));
  }
  for (const pid of playlistIds) tracks.push(...await fetchPlaylistTracks(api, pid));
  return { tracks, invalid };
}

// Conservative single-song attach: normalised title AND artist must both match a Spotify hit.
async function attachSpotifyToSong(db, id) {
  const song = (await db.query('SELECT id, title FROM songs WHERE id=$1', [id])).rows[0];
  if (!song) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  const artists = (await db.query(
    'SELECT a.name FROM song_artists sa JOIN artists a ON a.id=sa.artist_id WHERE sa.song_id=$1', [id])).rows.map(r => r.name);
  const api = await getSpotifyClient();
  const res = await withRetry(() => api.searchTracks(`track:${song.title} artist:${artists[0] || ''}`, { limit: 10 }));
  const nt = normalizeName(song.title), na0 = normalizeName(artists[0] || '');
  const hit = (res.body.tracks.items || []).find(t =>
    normalizeName(t.name) === nt && t.artists.some(a => normalizeName(a.name) === na0));
  if (!hit) return { matched: false };
  const track = mapTrack(hit);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const albumId = await upsertAlbum(client, track.album);
    await client.query(`
      UPDATE songs SET spotify_id=$2, spotify_url=$3, album_id=COALESCE(album_id,$4),
        duration_ms=COALESCE(duration_ms,$5), popularity=$6, explicit=$7,
        track_number=COALESCE(track_number,$8), disc_number=COALESCE(disc_number,$9),
        updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [id, track.spotify_id, track.spotify_url, albumId, track.duration_ms, track.popularity,
       track.explicit, track.track_number, track.disc_number]);
    for (const a of track.artists) {
      const artistId = await upsertArtist(client, a);
      await client.query('INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2) ON CONFLICT (song_id, artist_id) DO NOTHING', [id, artistId]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return { matched: true, spotify_id: track.spotify_id };
}

// Submissions → pending bridge (Session 2.2, ADMIN_AUDIT.md §3.3): add an approved
// community submission to the pending queue. Conservative Spotify match first (same
// rule as attachSpotifyToSong: normalised title AND artist must both match) for full
// enrichment via the candidate intake; otherwise a minimal manual pending song.
// Never touches an existing catalogue song.
async function addSubmissionAsPending(db, submissionId) {
  const sub = (await db.query('SELECT * FROM song_submissions WHERE id=$1', [submissionId])).rows[0];
  if (!sub) { const e = new Error('submission not found'); e.code = 'NOT_FOUND'; throw e; }
  if (sub.existing_song_id) {
    return { added: 0, skippedExisting: 1, song_id: sub.existing_song_id, matchedSpotify: false };
  }

  let track = null;
  try {
    const api = await getSpotifyClient();
    const res = await withRetry(() => api.searchTracks(`track:${sub.song_title} artist:${sub.artist_name}`, { limit: 10 }));
    const nt = normalizeName(sub.song_title), na = normalizeName(sub.artist_name);
    const hit = (res.body.tracks.items || []).find(t =>
      normalizeName(t.name) === nt && t.artists.some(a => normalizeName(a.name) === na));
    if (hit) track = mapTrack(hit);
  } catch (e) {
    console.warn('submission bridge: Spotify lookup failed, adding as manual:', e.message);
  }

  let songId = null, added = 0, skippedExisting = 0;
  if (track) {
    ({ added, skippedExisting } = await insertCandidates(db, [track]));
    const r = await db.query('SELECT id FROM songs WHERE spotify_id=$1', [track.spotify_id]);
    songId = r.rows.length ? r.rows[0].id : null;
  } else {
    // No confident Spotify match — dedupe by normalised title|artist like insertCandidates.
    const ta = normalizeName(sub.song_title) + '|' + normalizeName(sub.artist_name);
    const existing = (await db.query(`
      SELECT s.id, s.title, COALESCE(string_agg(a.name, ', '), '') AS artists
      FROM songs s
      LEFT JOIN song_artists sa ON sa.song_id = s.id
      LEFT JOIN artists a ON a.id = sa.artist_id
      GROUP BY s.id`)).rows;
    const dupe = existing.find(e => normalizeName(e.title) + '|' + normalizeName(e.artists) === ta);
    if (dupe) {
      skippedExisting = 1;
      songId = dupe.id;
    } else {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const song = await client.query(`
          INSERT INTO songs (title, data_source, status, status_notes)
          VALUES ($1, 'manual', 'pending', $2) RETURNING id`,
          [sub.song_title, `community submission #${sub.id}` +
            (sub.submitter_name ? ` from ${sub.submitter_name}` : '') + ' — added to pending queue']);
        songId = song.rows[0].id;
        const byName = await client.query('SELECT id FROM artists WHERE LOWER(name) = LOWER($1) LIMIT 1', [sub.artist_name]);
        const artistId = byName.rows.length ? byName.rows[0].id
          : (await client.query(`INSERT INTO artists (name, data_source) VALUES ($1, 'manual') RETURNING id`, [sub.artist_name])).rows[0].id;
        await client.query('INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2) ON CONFLICT (song_id, artist_id) DO NOTHING', [songId, artistId]);
        // Keep the submitted YouTube link — it becomes the song's play link.
        const yt = sub.youtube_url && String(sub.youtube_url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (yt) {
          await client.query(`
            INSERT INTO youtube_videos (song_id, youtube_id, thumbnail_url, video_type, is_primary, created_at)
            VALUES ($1, $2, $3, 'official', true, CURRENT_TIMESTAMP)`,
            [songId, yt[1], `https://img.youtube.com/vi/${yt[1]}/mqdefault.jpg`]);
        }
        await client.query('COMMIT');
        added = 1;
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
  }

  if (songId) {
    await db.query('UPDATE song_submissions SET existing_song_id=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [submissionId, songId]);
  }
  return { added, skippedExisting, song_id: songId, matchedSpotify: !!track };
}

module.exports = {
  normalizeName, listQueue, includeSong, rejectSong, setPlayLink, insertCandidates,
  resolveSpotifyUrls, attachSpotifyToSong, parseSpotifyRef, addSubmissionAsPending,
};
