// Session 1.1 consolidation import — spec: docs/TRUTH_SOURCE_DESIGN.md (approved 2026-07-07).
//
// Imports the two curator spreadsheets in docs/playlist/ into the truth-source schema.
// DRY-RUN BY DEFAULT: prints/logs what it would do. Pass --apply to write (single transaction).
// Idempotent: re-running matches previously imported rows by normalised artist+title.
//
// Usage:
//   node scripts/consolidateSpreadsheets.js            # dry run
//   node scripts/consolidateSpreadsheets.js --apply    # real run (take a DB backup first)
//
// Copyright guardrail: full lyrics go ONLY into the local-only song_lyrics table.
// This script never prints lyrics to the console or the log file (counts only).

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const pool = require('../database/db');

const APPLY = process.argv.includes('--apply');
const PLAYLIST_DIR = path.resolve(__dirname, '../../docs/playlist');
const FILE1 = path.join(PLAYLIST_DIR, 'playlist_with_lyrics_processed.xlsx');
const FILE2 = path.join(PLAYLIST_DIR, 'missing_from_playlist_processed_song_list_hybrid_with_lyrics.xlsx');
const LOG_DIR = path.resolve(__dirname, '../logs');

// ---------- helpers ----------

// Normalise for matching: lowercase, accents stripped, bracketed suffixes and punctuation removed.
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

// exceljs cell value → plain string
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(v);
}

function isJunkUrl(url) {
  return /search\?q=|[?&]q=|google\.[a-z.]+\/search|duckduckgo\.com/i.test(url);
}

function routeUrl(url) {
  if (!url) return null;
  if (isJunkUrl(url)) return 'junk';
  if (/bandcamp\.com/i.test(url)) return 'bandcamp';
  if (/soundcloud\.com/i.test(url)) return 'soundcloud';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  return 'lyrics';
}

// Split a spreadsheet artist string into individual artist names.
function splitArtists(s) {
  return String(s).split(/,\s+|;\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+/i)
    .map(x => x.trim()).filter(Boolean);
}

async function readSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const headers = ws.getRow(1).values.slice(1).map(cellText);
  const rows = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const rec = { _rowNum: rn };
    headers.forEach((h, i) => { rec[h] = cellText(row.getCell(i + 1).value).trim(); });
    if (Object.keys(rec).some(k => k !== '_rowNum' && rec[k] !== '')) rows.push(rec);
  });
  return rows;
}

// ---------- report ----------

const counts = {};                 // counter name -> n
const review = [];                 // { issue, artist, title, detail }
function count(name, n = 1) { counts[name] = (counts[name] || 0) + n; }
function flag(issue, artist, title, detail = '') { review.push({ issue, artist, title, detail }); }

// ---------- main ----------

(async () => {
  console.log(`=== Consolidation import — ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  const client = await pool.connect();
  let nextFakeId = -1;

  // exec: run writes only in apply mode; SELECTs always run on the client.
  async function exec(sql, params) {
    if (!APPLY) return { rows: [{ id: nextFakeId-- }] };
    return client.query(sql, params);
  }

  try {
    if (APPLY) await client.query('BEGIN');

    // --- Load DB into matching indexes ---
    const dbSongs = (await client.query(`
      SELECT s.id, s.title, s.status, s.lyrics_url, s.lyrics_status,
             COALESCE(array_agg(a.name) FILTER (WHERE a.name IS NOT NULL), '{}') AS artists
      FROM songs s
      LEFT JOIN song_artists sa ON sa.song_id = s.id
      LEFT JOIN artists a ON a.id = sa.artist_id
      GROUP BY s.id`)).rows;

    const byArtistTitle = new Map(); // "artistNorm|titleNorm" -> Set(songId)
    const byTitle = new Map();       // titleNorm -> Set(songId)
    const songById = new Map();
    function indexSong(s) {
      songById.set(s.id, s);
      const t = norm(s.title);
      if (!byTitle.has(t)) byTitle.set(t, new Set());
      byTitle.get(t).add(s.id);
      const keys = new Set(s.artists.map(a => `${norm(a)}|${t}`));
      if (s.artists.length > 1) keys.add(`${norm(s.artists.join(' '))}|${t}`);
      for (const k of keys) {
        if (!byArtistTitle.has(k)) byArtistTitle.set(k, new Set());
        byArtistTitle.get(k).add(s.id);
      }
    }
    dbSongs.forEach(indexSong);

    const dbArtists = (await client.query(`SELECT id, name FROM artists`)).rows;
    const artistByNorm = new Map(dbArtists.map(a => [norm(a.name), a.id]));

    // Match one spreadsheet row to DB song ids.
    function match(artistStr, title) {
      const t = norm(title);
      const tried = new Set();
      const hits = new Set();
      const candidates = [norm(artistStr), ...splitArtists(artistStr).map(norm)];
      for (const a of candidates) {
        const k = `${a}|${t}`;
        if (tried.has(k)) continue;
        tried.add(k);
        for (const id of byArtistTitle.get(k) || []) hits.add(id);
      }
      const titleOnly = (byTitle.get(t) || new Set()).size > 0;
      return { ids: [...hits], titleOnly };
    }

    async function findOrCreateArtist(name) {
      const key = norm(name);
      if (artistByNorm.has(key)) return artistByNorm.get(key);
      const r = await exec(
        `INSERT INTO artists (name, data_source) VALUES ($1, 'manual') RETURNING id`, [name]);
      artistByNorm.set(key, r.rows[0].id);
      count('artists inserted');
      return r.rows[0].id;
    }

    async function insertSong({ title, artistStr, status, statusNotes, lyricsStatus, urls }) {
      const r = await exec(
        `INSERT INTO songs (title, status, status_notes, lyrics_status, lyrics_url, bandcamp_url, soundcloud_url, data_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING id`,
        [title, status, statusNotes || null, lyricsStatus,
         urls.lyrics || null, urls.bandcamp || null, urls.soundcloud || null]);
      const id = r.rows[0].id;
      for (const a of splitArtists(artistStr)) {
        const artistId = await findOrCreateArtist(a);
        await exec(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2)`, [id, artistId]);
      }
      const rec = { id, title, status, lyrics_url: urls.lyrics || null, lyrics_status: lyricsStatus, artists: splitArtists(artistStr) };
      indexSong(rec); // later rows (and re-runs within this run) can match it
      return id;
    }

    async function upsertLyrics(songId, lyrics, sourceUrl) {
      await exec(
        `INSERT INTO song_lyrics (song_id, lyrics, source_url) VALUES ($1, $2, $3)
         ON CONFLICT (song_id) DO UPDATE
         SET lyrics = EXCLUDED.lyrics, source_url = EXCLUDED.source_url, imported_at = CURRENT_TIMESTAMP`,
        [songId, lyrics, sourceUrl || null]);
      count('song_lyrics upserted');
    }

    // Append a note once (idempotent).
    async function appendNote(songId, note) {
      await exec(
        `UPDATE songs SET status_notes = CASE
           WHEN status_notes IS NULL OR status_notes = '' THEN $2
           WHEN position($2 in status_notes) = 0 THEN status_notes || '; ' || $2
           ELSE status_notes END,
         updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, [songId, note]);
    }

    const lyricsSetByFile1 = new Set(); // rule 6: file 1's valid lyrics win the 65-row overlap

    // =================== FILE 1: playlist_with_lyrics_processed ===================
    const rows1 = await readSheet(FILE1);
    console.log(`File 1: ${rows1.length} rows`);
    for (const r of rows1) {
      const artist = r['Artists'], title = r['Title'], status = r['Status'];
      const url = r['Lyrics URL'], lyrics = r['Lyrics'];
      const m = match(artist, title);
      if (m.ids.length === 0) {
        count(m.titleOnly ? 'file1 title-only match (review)' : 'file1 unmatched (review)');
        flag(m.titleOnly ? 'file1-title-only' : 'file1-unmatched', artist, title);
        continue;
      }
      if (m.ids.length > 1) {
        count('file1 multi-match (review)');
        flag('file1-multi-match', artist, title, `song ids ${m.ids.join(', ')}`);
        continue;
      }
      const song = songById.get(m.ids[0]);
      if (status === '✅ Valid') {
        await exec(
          `UPDATE songs SET lyrics_url = $2, lyrics_status = 'found', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [song.id, url]);
        if (lyrics) await upsertLyrics(song.id, lyrics, url);
        lyricsSetByFile1.add(song.id);
        count('file1 valid: lyrics applied');
      } else { // '?' — junk search URL, lyrics not found
        if (song.lyrics_url) {
          count('file1 ?: existing lyrics_url kept (review)');
          flag('file1-notfound-vs-existing-url', artist, title,
            `sheet says lyrics not found but song ${song.id} already has lyrics_url`);
        } else {
          await exec(
            `UPDATE songs SET lyrics_status = 'not_found', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND lyrics_status <> 'found'`, [song.id]);
          count('file1 ?: marked not_found, junk URL discarded');
        }
      }
    }

    // =================== FILE 2: missing_from_playlist… ===================
    const rows2 = await readSheet(FILE2);
    console.log(`File 2: ${rows2.length} rows`);
    for (const r of rows2) {
      const artist = r['Artist'], title = r['Song'];
      const processed = r['Processed'], url = r['URL'], lyrics = r['Scraped Lyrics'];
      const p = processed.toLowerCase();

      let cls;
      if (/^1/.test(p)) cls = 'include';
      else if (p === '0') cls = 'reject';
      else cls = 'pending';

      const cantFind = /can'?t find lyrics/i.test(p);
      const notOnSpotify = /not on spotify/i.test(p);
      const recognisedPending = cantFind || p === '?';
      if (cls === 'pending' && !recognisedPending) {
        count('file2 pending: unclassified Processed value (review)');
        flag('file2-unclassified-processed', artist, title, `Processed="${processed}"`);
      }

      // Route the URL to the right column; junk is discarded.
      const urls = {};
      let urlNote = null;
      const route = routeUrl(url);
      if (route === 'junk') count('file2 junk URL discarded');
      else if (route === 'bandcamp') urls.bandcamp = url;
      else if (route === 'soundcloud') urls.soundcloud = url;
      else if (route === 'youtube') { urlNote = `youtube: ${url}`; count('file2 youtube URL noted'); }
      else if (route === 'lyrics') urls.lyrics = url;

      // Lyrics rules (2/4): store scraped lyrics; 'found' only if the curator didn't say can't-find.
      const hasLyrics = !!lyrics;
      const lyricsStatus = hasLyrics && !cantFind ? 'found' : cantFind ? 'not_found' : 'not_searched';
      const reviewLyricsNote = hasLyrics && cantFind
        ? "scraped lyrics stored but curator marked can't-find — review" : null;

      const notes = [];
      if (notOnSpotify) notes.push('not on spotify');
      if (cls === 'reject') notes.push('rejected in spreadsheet review');
      if (cls === 'pending') notes.push(recognisedPending
        ? (cantFind ? "pending review: can't find lyrics" : 'pending review: undecided (?)')
        : `pending review: unclassified spreadsheet value "${processed}"`);
      if (reviewLyricsNote) notes.push(reviewLyricsNote);
      if (urlNote) notes.push(urlNote);

      const m = match(artist, title);
      if (m.ids.length > 1) {
        count('file2 multi-match (review)');
        flag('file2-multi-match', artist, title, `song ids ${m.ids.join(', ')}`);
        continue;
      }

      if (m.ids.length === 1) {
        const song = songById.get(m.ids[0]);
        // Never change the status of a matched song that's already included (curator owns it).
        if (cls !== 'include' && song.status === 'included') {
          count(`file2 ${cls}: already included in DB (review)`);
          flag(`file2-${cls}-but-db-included`, artist, title, `song ${song.id} is included; sheet says ${cls}`);
          continue;
        }
        // Rejected rows stay minimal — no lyrics/URL enrichment (re-run no-op).
        if (song.status === 'rejected') {
          if (cls !== 'reject') flag('file2-matched-rejected-song', artist, title,
            `song ${song.id} is rejected; sheet says ${cls}`);
          count(`file2 ${cls}: matched rejected song (no enrichment)`);
          continue;
        }
        // Matched include (or re-run of a previously imported reject/pending row): apply details.
        if (hasLyrics && !lyricsSetByFile1.has(song.id) && !cantFind) {
          await upsertLyrics(song.id, lyrics, url && route !== 'junk' ? url : null);
          await exec(
            `UPDATE songs SET lyrics_status = 'found', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [song.id]);
          count(`file2 ${cls} matched: lyrics applied`);
        } else if (hasLyrics && lyricsSetByFile1.has(song.id)) {
          count('file2 lyrics skipped (file 1 wins overlap)');
        }
        if (cantFind && song.lyrics_status !== 'found' && !lyricsSetByFile1.has(song.id)) {
          await exec(
            `UPDATE songs SET lyrics_status = 'not_found', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND lyrics_status <> 'found'`, [song.id]);
          count(`file2 ${cls} matched: marked lyrics not_found`);
        }
        if (urls.bandcamp) await exec(
          `UPDATE songs SET bandcamp_url = COALESCE(bandcamp_url, $2) WHERE id = $1`, [song.id, urls.bandcamp]);
        if (urls.soundcloud) await exec(
          `UPDATE songs SET soundcloud_url = COALESCE(soundcloud_url, $2) WHERE id = $1`, [song.id, urls.soundcloud]);
        if (urls.lyrics && !song.lyrics_url && !lyricsSetByFile1.has(song.id)) await exec(
          `UPDATE songs SET lyrics_url = $2 WHERE id = $1`, [song.id, urls.lyrics]);
        for (const n of notes) if (n !== 'rejected in spreadsheet review') await appendNote(song.id, n);
        count(`file2 ${cls}: matched existing song`);
      } else {
        // Unmatched → new row.
        const status = cls === 'include' ? 'included' : cls === 'reject' ? 'rejected' : 'pending';
        const id = await insertSong({
          title, artistStr: artist, status,
          statusNotes: notes.join('; ') || null,
          lyricsStatus: cls === 'reject' ? 'not_searched' : lyricsStatus,
          urls: cls === 'reject' ? {} : urls, // rejects are imported minimally
        });
        if (cls !== 'reject' && hasLyrics) await upsertLyrics(id, lyrics, url && route !== 'junk' ? url : null);
        count(`file2 ${cls}: inserted new song`);
        if (m.titleOnly) flag('file2-new-but-title-exists', artist, title,
          'inserted as new; a song with the same title exists under another artist');
      }
    }

    if (APPLY) await client.query('COMMIT');

    // =================== report ===================
    const lines = [];
    lines.push(`Consolidation import — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${new Date().toISOString()}`);
    lines.push('', '--- Counts ---');
    for (const k of Object.keys(counts).sort()) lines.push(`${String(counts[k]).padStart(5)}  ${k}`);
    lines.push('', `--- Review report (${review.length} items, not auto-applied) ---`);
    for (const it of review) lines.push(`[${it.issue}] ${it.artist} — ${it.title}${it.detail ? ` (${it.detail})` : ''}`);
    const text = lines.join('\n');
    console.log('\n' + text.split('\n').slice(0, 60).join('\n'));
    if (review.length > 40) console.log(`… (full review list in log file)`);
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `consolidation-${APPLY ? 'apply' : 'dryrun'}-${Date.now()}.log`);
    fs.writeFileSync(logFile, text);
    console.log(`\nLog written: ${logFile}`);
    if (!APPLY) console.log('\nDry run only — nothing written. Re-run with --apply after a DB backup.');
  } catch (err) {
    if (APPLY) await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED' + (APPLY ? ' (rolled back)' : '') + ':', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
