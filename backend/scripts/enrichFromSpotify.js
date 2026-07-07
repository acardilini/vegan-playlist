// Session 1.2 Spotify enrichment pipeline — spec: docs/TRUTH_SOURCE_DESIGN.md +
// docs/SPOTIFY_API_AUDIT.md §3/§6. Single replacement for the three legacy import paths.
//
// The truth source is authoritative: this script writes ONLY enrichment-class fields
// (spotify ids/urls, duration, popularity, explicit, track/disc numbers, album
// images/dates/labels, artist genres/images/followers). It never writes status,
// status_notes of existing songs, categorisation, reviews, ratings, lyrics or featured.
//
// DRY-RUN BY DEFAULT: pass --apply to write. Stages (default all):
//   --albums   backfill albums that have a spotify_id but no images/release_date/label
//   --artists  backfill artists that have a spotify_id but no genres/images
//   --attach   find Spotify matches for manual 'included' songs without a spotify_id
//              (skips songs whose status_notes say 'not on spotify')
//   --diff     import-only playlist diff report; with --apply, adds playlist tracks
//              missing from the catalogue as status='pending'
//
// Usage:
//   node scripts/enrichFromSpotify.js                  # dry-run everything
//   node scripts/enrichFromSpotify.js --apply          # real run (backup first)
//   node scripts/enrichFromSpotify.js --attach --apply # one stage only

const fs = require('fs');
const path = require('path');
const pool = require('../database/db');
const {
  getSpotifyClient, withRetry, fetchPlaylistTracks, computeDiff,
  addTracksAsPending, upsertAlbum, upsertArtist, normalizeReleaseDate,
} = require('../utils/playlistSync');

const APPLY = process.argv.includes('--apply');
const stageFlags = ['--albums', '--artists', '--attach', '--diff'].filter(f => process.argv.includes(f));
const STAGES = stageFlags.length > 0 ? stageFlags.map(f => f.slice(2)) : ['attach', 'albums', 'artists', 'diff'];
const LOG_DIR = path.resolve(__dirname, '../logs');

const counts = {};
const review = [];
function count(name, n = 1) { counts[name] = (counts[name] || 0) + n; }
function flag(issue, what, detail = '') { review.push({ issue, what, detail }); }

// Same normalisation as consolidateSpreadsheets.js (matching key).
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`=== Spotify enrichment — ${APPLY ? 'APPLY' : 'DRY RUN'} — stages: ${STAGES.join(', ')} ===`);
  const spotifyApi = await getSpotifyClient();
  const client = await pool.connect();

  async function exec(sql, params) {
    if (!APPLY) return { rows: [{ id: -1 }] };
    return client.query(sql, params);
  }

  try {
    // ---------------- attach: Spotify matches for manual included songs ----------------
    if (STAGES.includes('attach')) {
      const songs = (await client.query(`
        SELECT s.id, s.title, s.status_notes,
               array_agg(a.name) FILTER (WHERE a.name IS NOT NULL) AS artists
        FROM songs s
        LEFT JOIN song_artists sa ON sa.song_id = s.id
        LEFT JOIN artists a ON a.id = sa.artist_id
        WHERE s.spotify_id IS NULL AND s.data_source = 'manual' AND s.status = 'included'
        GROUP BY s.id ORDER BY s.id`)).rows;
      console.log(`attach: ${songs.length} manual included songs without spotify_id`);

      // dry-run-safe album upsert used by attach
      const upsertAlbumDry = async (album) => {
        if (!album || !album.id) return null;
        const a = {
          spotify_id: album.id, name: album.name, images: album.images || [],
          release_date: album.release_date || null, total_tracks: album.total_tracks || null,
          album_type: album.album_type || null,
          spotify_url: album.external_urls && album.external_urls.spotify,
        };
        if (!APPLY) {
          const existing = await client.query(`SELECT id FROM albums WHERE spotify_id = $1`, [a.spotify_id]);
          if (existing.rows.length === 0) count('attach: album would be created');
          return existing.rows.length > 0 ? existing.rows[0].id : null;
        }
        return upsertAlbum(client, a);
      };

      for (const song of songs) {
        if (/not on spotify/i.test(song.status_notes || '')) {
          count('attach: skipped (noted not on spotify)');
          continue;
        }
        const artistStr = (song.artists || []).join(' ');
        const q = `track:"${song.title.replace(/"/g, '')}" artist:"${(song.artists || [''])[0].replace(/"/g, '')}"`;
        let items = [];
        try {
          const res = await withRetry(() => spotifyApi.searchTracks(q, { limit: 5 }));
          items = res.body.tracks.items;
          if (items.length === 0) {
            const res2 = await withRetry(() => spotifyApi.searchTracks(`${song.title} ${artistStr}`, { limit: 5 }));
            items = res2.body.tracks.items;
          }
        } catch (err) {
          count('attach: search error');
          flag('attach-search-error', `${artistStr} — ${song.title}`, err.message);
          continue;
        }
        await sleep(120);

        const songArtistNorms = new Set((song.artists || []).map(norm));
        const match = items.find(t =>
          norm(t.name) === norm(song.title) &&
          t.artists.some(a => songArtistNorms.has(norm(a.name))));

        if (!match) {
          count(items.length === 0 ? 'attach: no results (review)' : 'attach: no confident match (review)');
          flag('attach-no-match', `${artistStr} — ${song.title}`,
            items.slice(0, 3).map(t => `${t.artists.map(a => a.name).join(', ')} — ${t.name}`).join(' | ') || 'no results');
          continue;
        }

        // Enrichment-only writes: ids/urls, duration, popularity, explicit, album link.
        const albumId = await upsertAlbumDry(match.album);
        await exec(`
          UPDATE songs SET spotify_id = $2, spotify_url = $3, duration_ms = $4, popularity = $5,
                 explicit = $6, track_number = $7, disc_number = $8,
                 album_id = COALESCE(album_id, $9), updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
          [song.id, match.id, match.external_urls.spotify, match.duration_ms, match.popularity,
           match.explicit, match.track_number, match.disc_number, albumId]);
        // Fill spotify_id on same-named linked artists (genres/images come from the artist stage).
        for (const a of match.artists) {
          if (songArtistNorms.has(norm(a.name))) {
            // artists_source_check requires data_source='spotify' once a spotify_id is set
            await exec(`
              UPDATE artists SET spotify_id = $2, spotify_url = COALESCE(spotify_url, $3),
                     data_source = 'spotify', updated_at = CURRENT_TIMESTAMP
              WHERE spotify_id IS NULL AND LOWER(name) = ANY($1)`,
              [(song.artists || []).filter(n => norm(n) === norm(a.name)).map(n => n.toLowerCase()),
               a.id, a.external_urls && a.external_urls.spotify]);
          } else {
            flag('attach-extra-artist', `${artistStr} — ${song.title}`,
              `Spotify also credits "${a.name}" (link not added)`);
          }
        }
        count('attach: matched and enriched');
      }
    }

    // ---------------- albums: backfill images/dates/labels ----------------
    if (STAGES.includes('albums')) {
      const bare = (await client.query(`
        SELECT id, spotify_id FROM albums
        WHERE spotify_id IS NOT NULL
          AND (images IS NULL OR images::text IN ('null','[]') OR release_date IS NULL OR label IS NULL)
        ORDER BY id`)).rows;
      console.log(`albums: ${bare.length} to backfill`);
      for (let i = 0; i < bare.length; i += 20) {
        const batch = bare.slice(i, i + 20);
        const res = await withRetry(() => spotifyApi.getAlbums(batch.map(b => b.spotify_id)));
        for (const albumData of res.body.albums) {
          if (!albumData) { count('albums: id not found on Spotify (review)'); continue; }
          const row = batch.find(b => b.spotify_id === albumData.id);
          await exec(`
            UPDATE albums SET images = $2, release_date = COALESCE(release_date, $3),
                   total_tracks = COALESCE(total_tracks, $4), album_type = COALESCE(album_type, $5),
                   label = COALESCE(label, $6), spotify_url = COALESCE(spotify_url, $7)
            WHERE id = $1`,
            [row.id, JSON.stringify(albumData.images || []), normalizeReleaseDate(albumData.release_date),
             albumData.total_tracks, albumData.album_type, albumData.label,
             albumData.external_urls && albumData.external_urls.spotify]);
          count('albums: backfilled');
        }
        await sleep(200);
      }
    }

    // ---------------- artists: backfill genres/images/followers ----------------
    if (STAGES.includes('artists')) {
      const bare = (await client.query(`
        SELECT id, spotify_id FROM artists
        WHERE spotify_id IS NOT NULL
          AND (genres IS NULL OR array_length(genres, 1) IS NULL
               OR images IS NULL OR images::text IN ('null','[]'))
        ORDER BY id`)).rows;
      console.log(`artists: ${bare.length} to backfill`);
      for (let i = 0; i < bare.length; i += 50) {
        const batch = bare.slice(i, i + 50);
        const res = await withRetry(() => spotifyApi.getArtists(batch.map(b => b.spotify_id)));
        for (const artistData of res.body.artists) {
          if (!artistData) { count('artists: id not found on Spotify (review)'); continue; }
          const row = batch.find(b => b.spotify_id === artistData.id);
          await exec(`
            UPDATE artists SET genres = $2, images = $3, followers = $4, popularity = $5,
                   spotify_url = COALESCE(spotify_url, $6), updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
            [row.id, artistData.genres || [], JSON.stringify(artistData.images || []),
             artistData.followers ? artistData.followers.total : null, artistData.popularity,
             artistData.external_urls && artistData.external_urls.spotify]);
          count('artists: backfilled');
        }
        await sleep(200);
      }
    }

    // ---------------- diff: import-only playlist comparison ----------------
    if (STAGES.includes('diff')) {
      const tracks = await fetchPlaylistTracks(spotifyApi);
      const diff = await computeDiff(pool, tracks);
      console.log(`diff: playlist ${diff.playlistTrackCount} tracks; ` +
        `${diff.missingFromCatalogue.length} not in catalogue; ` +
        `${diff.includedNotOnPlaylist.length} included songs not on playlist; ` +
        `${diff.nonIncludedOnPlaylist.length} pending/rejected songs on playlist`);
      count('diff: playlist tracks', diff.playlistTrackCount);
      count('diff: missing from catalogue', diff.missingFromCatalogue.length);
      count('diff: included not on playlist', diff.includedNotOnPlaylist.length);
      count('diff: non-included on playlist', diff.nonIncludedOnPlaylist.length);
      for (const t of diff.missingFromCatalogue)
        flag('diff-add-as-pending', `${t.artists.map(a => a.name).join(', ')} — ${t.title}`, t.spotify_id);
      for (const s of diff.includedNotOnPlaylist)
        flag('diff-included-not-on-playlist', `${s.artists || '?'} — ${s.title}`,
          `song ${s.id}; website is master — update Spotify manually if desired`);
      for (const s of diff.nonIncludedOnPlaylist)
        flag('diff-on-playlist-but-' + s.status, `${s.artists || '?'} — ${s.title}`, `song ${s.id}`);
      if (APPLY && diff.missingFromCatalogue.length > 0) {
        const added = await addTracksAsPending(pool, diff.missingFromCatalogue);
        count('diff: added as pending', added);
      }
    }

    // ---------------- report ----------------
    const lines = [];
    lines.push(`Spotify enrichment — ${APPLY ? 'APPLY' : 'DRY RUN'} — stages ${STAGES.join(',')} — ${new Date().toISOString()}`);
    lines.push('', '--- Counts ---');
    for (const k of Object.keys(counts).sort()) lines.push(`${String(counts[k]).padStart(5)}  ${k}`);
    lines.push('', `--- Review (${review.length} items) ---`);
    for (const it of review) lines.push(`[${it.issue}] ${it.what}${it.detail ? ` (${it.detail})` : ''}`);
    const text = lines.join('\n');
    console.log('\n' + text.split('\n').slice(0, 50).join('\n'));
    if (review.length > 30) console.log('… (full review list in log file)');
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `enrichment-${APPLY ? 'apply' : 'dryrun'}-${Date.now()}.log`);
    fs.writeFileSync(logFile, text);
    console.log(`\nLog written: ${logFile}`);
    if (!APPLY) console.log('\nDry run only — nothing written. Re-run with --apply after a DB backup.');
  } catch (err) {
    console.error('FAILED:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
