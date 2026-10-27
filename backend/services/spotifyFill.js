// "Fill from Spotify link" (workbench): read the track behind a song's own Spotify URL and let the curator
// choose which of title / artists / album+released / Spotify id to take from it. preview() is read-only;
// apply() re-reads the track itself (never trusts client-sent values), writes only the chosen fields in one
// transaction, and never touches curated fields (status, notes, categorisation, lyrics...).
//
// Nothing here may log or rethrow a Spotify error's message (it can carry request detail): failures
// are fixed strings + .code (UPSTREAM / RATE_LIMITED).
const { upsertAlbum, upsertArtist, normalizeReleaseDate } = require('../utils/playlistSync');
const staging = require('./staging');
const curation = require('./curation');

const FIELDS = ['spotify_id', 'title', 'artists', 'album'];

function fail(code, message) { const e = new Error(message); e.code = code; return e; }

async function defaultFetchTrack(trackId) {
  const { tracks } = await staging.resolveSpotifyUrls([`spotify:track:${trackId}`]);
  return tracks[0] || null;
}

async function loadSong(db, id) {
  const s = (await db.query(
    `SELECT s.id, s.title, s.spotify_id, s.spotify_url, al.name AS album_name, al.spotify_id AS album_spotify_id,
            to_char(al.release_date, 'YYYY-MM-DD') AS album_date
     FROM songs s LEFT JOIN albums al ON al.id=s.album_id WHERE s.id=$1`, [id])).rows[0];
  if (!s) throw fail('NOT_FOUND', 'song not found');
  s.artists = (await db.query(
    `SELECT a.name, a.spotify_id FROM song_artists sa JOIN artists a ON a.id=sa.artist_id WHERE sa.song_id=$1 ORDER BY sa.id`, [id])).rows;
  return s;
}

async function readTrack(song, fetchTrack) {
  const ref = song.spotify_url ? staging.parseSpotifyRef(song.spotify_url) : null;
  if (!ref || ref.type !== 'track') throw fail('BAD_INPUT', 'Add a Spotify track link to this song first');
  let track;
  try { track = await fetchTrack(ref.id); } catch (err) {
    if (err && err.code === 'RATE_LIMITED') throw err; // fixed, safe message from withRetry
    throw fail('UPSTREAM', 'Could not read that track from Spotify');
  }
  if (!track) throw fail('UPSTREAM', 'Spotify has no track at that link');
  return track;
}

async function findConflict(db, songId, trackId) {
  const r = (await db.query('SELECT id, title FROM songs WHERE spotify_id=$1 AND id<>$2', [trackId, songId])).rows[0];
  return r ? { song_id: r.id, title: r.title } : null;
}

const albumText = (name, date) => (name ? `${name}${date ? ` (${date})` : ''}` : '—');

async function preview(db, id, { fetchTrack = defaultFetchTrack } = {}) {
  const song = await loadSong(db, id);
  const track = await readTrack(song, fetchTrack);
  const names = (list) => list.map((a) => a.name).join(', ') || '—';
  const sameArtists = song.artists.length === track.artists.length
    && song.artists.every((a, i) => a.spotify_id && a.spotify_id === track.artists[i].spotify_id);
  const trackDate = track.album ? normalizeReleaseDate(track.album.release_date) : null;
  const fields = [
    { key: 'spotify_id', label: 'Spotify id', current: song.spotify_id || '—', spotify: track.spotify_id,
      differs: song.spotify_id !== track.spotify_id },
    { key: 'title', label: 'Title', current: song.title, spotify: track.title, differs: song.title !== track.title },
    { key: 'artists', label: 'Artist(s)', current: names(song.artists), spotify: names(track.artists), differs: !sameArtists },
    { key: 'album', label: 'Album and released', current: albumText(song.album_name, song.album_date),
      spotify: track.album ? albumText(track.album.name, trackDate) : '—',
      differs: !!track.album && song.album_spotify_id !== track.album.spotify_id },
  ];
  return { fields, conflict: await findConflict(db, id, track.spotify_id) };
}

async function apply(db, id, { fields } = {}, { fetchTrack = defaultFetchTrack } = {}) {
  if (!Array.isArray(fields) || fields.length === 0) throw fail('BAD_INPUT', 'Choose at least one field to fill');
  if (!fields.every((f) => FIELDS.includes(f))) throw fail('BAD_INPUT', 'Unknown field');
  const song = await loadSong(db, id);
  const track = await readTrack(song, fetchTrack);
  if (fields.includes('spotify_id')) {
    const c = await findConflict(db, id, track.spotify_id);
    if (c) throw fail('BAD_INPUT', `Song #${c.song_id} ("${c.title}") already has this Spotify id`);
  }
  if (fields.includes('album') && !track.album) throw fail('BAD_INPUT', 'Spotify lists no album for this track');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (fields.includes('spotify_id')) {
      await client.query(
        `UPDATE songs SET spotify_id=$2, spotify_url=$3, duration_ms=$4, popularity=$5, explicit=$6,
                track_number=$7, disc_number=$8 WHERE id=$1`,
        [id, track.spotify_id, track.spotify_url, track.duration_ms, track.popularity, track.explicit,
          track.track_number, track.disc_number]);
    }
    if (fields.includes('title')) await client.query('UPDATE songs SET title=$2 WHERE id=$1', [id, track.title]);
    if (fields.includes('album')) {
      const albumId = await upsertAlbum(client, track.album);
      await client.query('UPDATE songs SET album_id=$2 WHERE id=$1', [id, albumId]);
    }
    if (fields.includes('artists')) {
      await client.query('DELETE FROM song_artists WHERE song_id=$1', [id]);
      const seen = new Set();
      for (const a of track.artists) {
        const artistId = await upsertArtist(client, a);
        if (seen.has(artistId)) continue;
        seen.add(artistId);
        await client.query('INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)', [id, artistId]);
      }
    }
    await client.query('UPDATE songs SET updated_at=CURRENT_TIMESTAMP WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return curation.getWorkbench(db, id);
}

module.exports = { FIELDS, preview, apply };
