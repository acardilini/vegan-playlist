// Truth-source playlist sync helpers (Session 1.2) — spec: docs/TRUTH_SOURCE_DESIGN.md.
//
// The website is master; Spotify is enrichment. Sync direction is IMPORT-ONLY:
// playlist tracks missing from the catalogue can be added as status='pending';
// nothing here ever changes the status of an existing song, flags removals, or
// writes curator-owned fields (status/notes/categorisation/review/rating/lyrics/featured).

const SpotifyWebApi = require('spotify-web-api-node');

const DEFAULT_PLAYLIST_ID = '5hVygGomw9zax38quC6mhi'; // "Animal Lib & Vegan Songs"

async function getSpotifyClient() {
  const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  });
  const auth = await spotifyApi.clientCredentialsGrant();
  spotifyApi.setAccessToken(auth.body['access_token']);
  return spotifyApi;
}

// Retry a Spotify call once per 429, honouring Retry-After.
async function withRetry(fn) {
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err.statusCode === 429) {
        const wait = (parseInt(err.headers && err.headers['retry-after']) || 2) + 1;
        console.log(`  rate limited — waiting ${wait}s`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      throw err;
    }
  }
}

// All tracks on the playlist, with full album objects and real added_at.
async function fetchPlaylistTracks(spotifyApi, playlistId = DEFAULT_PLAYLIST_ID) {
  const tracks = [];
  let offset = 0;
  for (;;) {
    const page = await withRetry(() => spotifyApi.getPlaylistTracks(playlistId, {
      offset, limit: 100,
      fields: 'items(added_at,track(id,name,duration_ms,popularity,explicit,track_number,disc_number,external_urls,artists(id,name,external_urls),album(id,name,images,release_date,total_tracks,album_type,external_urls))),next',
    }));
    for (const item of page.body.items) {
      const t = item.track;
      if (!t || !t.id) continue;
      tracks.push({
        spotify_id: t.id,
        title: t.name,
        duration_ms: t.duration_ms,
        popularity: t.popularity,
        explicit: t.explicit,
        track_number: t.track_number,
        disc_number: t.disc_number,
        spotify_url: t.external_urls && t.external_urls.spotify,
        added_at: item.added_at,
        artists: (t.artists || []).map(a => ({
          spotify_id: a.id, name: a.name,
          spotify_url: a.external_urls && a.external_urls.spotify,
        })),
        album: t.album && t.album.id ? {
          spotify_id: t.album.id,
          name: t.album.name,
          images: t.album.images || [],
          release_date: t.album.release_date || null,
          total_tracks: t.album.total_tracks || null,
          album_type: t.album.album_type || null,
          spotify_url: t.album.external_urls && t.album.external_urls.spotify,
        } : null,
      });
    }
    if (!page.body.next) break;
    offset += 100;
  }
  return tracks;
}

// Import-only diff between the playlist and the whole catalogue (all statuses).
async function computeDiff(pool, tracks) {
  const dbSongs = (await pool.query(`
    SELECT s.id, s.spotify_id, s.title, s.status,
           string_agg(a.name, ', ') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    WHERE s.spotify_id IS NOT NULL
    GROUP BY s.id`)).rows;
  const dbIds = new Set(dbSongs.map(s => s.spotify_id));
  const playlistIds = new Set(tracks.map(t => t.spotify_id));
  return {
    playlistTrackCount: tracks.length,
    // On the playlist, nowhere in the catalogue → candidates for the pending queue.
    missingFromCatalogue: tracks.filter(t => !dbIds.has(t.spotify_id)),
    // Included in the catalogue but not on the playlist → informational only
    // (the curator updates Spotify by hand if desired).
    includedNotOnPlaylist: dbSongs.filter(s => s.status === 'included' && !playlistIds.has(s.spotify_id)),
    // On the playlist but pending/rejected in the catalogue → curator info.
    nonIncludedOnPlaylist: dbSongs.filter(s => s.status !== 'included' && playlistIds.has(s.spotify_id)),
  };
}

// Release-date strings can be '1994', '1994-06' or '1994-06-27'.
function normalizeReleaseDate(d) {
  if (!d) return null;
  if (/^\d{4}$/.test(d)) return `${d}-01-01`;
  if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
  return d;
}

// Find-or-create an album row from a Spotify album object (full enrichment data).
async function upsertAlbum(client, album) {
  if (!album) return null;
  const existing = await client.query(`SELECT id FROM albums WHERE spotify_id = $1`, [album.spotify_id]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const r = await client.query(`
    INSERT INTO albums (spotify_id, name, images, release_date, total_tracks, album_type, spotify_url, data_source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'spotify') RETURNING id`,
    [album.spotify_id, album.name, JSON.stringify(album.images),
     normalizeReleaseDate(album.release_date), album.total_tracks, album.album_type, album.spotify_url]);
  return r.rows[0].id;
}

// Find-or-create an artist row from a Spotify artist object; backfills spotify_id
// on a same-named artist that lacks one (genres/images come from the artist
// enrichment pass, which targets artists with a spotify_id and no genres).
async function upsertArtist(client, artist) {
  const byId = await client.query(`SELECT id FROM artists WHERE spotify_id = $1`, [artist.spotify_id]);
  if (byId.rows.length > 0) return byId.rows[0].id;
  const byName = await client.query(
    `SELECT id FROM artists WHERE LOWER(name) = LOWER($1) AND spotify_id IS NULL LIMIT 1`, [artist.name]);
  if (byName.rows.length > 0) {
    // artists_source_check requires data_source='spotify' once a spotify_id is set
    await client.query(`UPDATE artists SET spotify_id = $2, spotify_url = COALESCE(spotify_url, $3),
                        data_source = 'spotify', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [byName.rows[0].id, artist.spotify_id, artist.spotify_url || null]);
    return byName.rows[0].id;
  }
  const r = await client.query(`
    INSERT INTO artists (spotify_id, name, spotify_url, data_source)
    VALUES ($1, $2, $3, 'spotify') RETURNING id`,
    [artist.spotify_id, artist.name, artist.spotify_url || null]);
  return r.rows[0].id;
}

// Insert playlist tracks as status='pending' rows with full enrichment.
// Never touches existing songs. Returns the number added.
async function addTracksAsPending(pool, tracks, note) {
  if (tracks.length === 0) return 0;
  const client = await pool.connect();
  let added = 0;
  try {
    await client.query('BEGIN');
    for (const t of tracks) {
      const albumId = await upsertAlbum(client, t.album);
      const song = await client.query(`
        INSERT INTO songs (spotify_id, title, album_id, duration_ms, popularity, spotify_url,
                           explicit, track_number, disc_number, playlist_added_at, playlist_added_by,
                           data_source, status, status_notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'playlist-diff', 'spotify', 'pending', $11)
        RETURNING id`,
        [t.spotify_id, t.title, albumId, t.duration_ms, t.popularity, t.spotify_url,
         t.explicit, t.track_number, t.disc_number, t.added_at,
         note || 'on Spotify playlist, not in catalogue — added as pending by playlist diff']);
      for (const a of t.artists) {
        const artistId = await upsertArtist(client, a);
        await client.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2)`, [song.rows[0].id, artistId]);
      }
      added++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return added;
}

module.exports = {
  DEFAULT_PLAYLIST_ID,
  getSpotifyClient,
  withRetry,
  fetchPlaylistTracks,
  computeDiff,
  addTracksAsPending,
  upsertAlbum,
  upsertArtist,
  normalizeReleaseDate,
};
