// YouTube candidate search for the workbench Video panel (sub-project D).
// Official YouTube Data API v3. `fetch` is injectable so tests never touch the network.
// SECURITY: the request URL contains the API key, so nothing here may log or rethrow a URL,
// a fetch error's message, or its `.cause` — only the HTTP status and Google's `reason`.
const API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 8;

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

const NAMED = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
function decodeEntities(s) {
  return String(s ?? '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|[a-z]+);/gi, (m, dec, hex) => {
    if (dec || hex) {
      const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[m.toLowerCase()] ?? m;
  });
}

// ISO-8601 duration -> "m:ss" / "h:mm:ss"; null when absent/unparseable (e.g. live streams: "P0D").
function formatDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const h = +(m[1] || 0), min = +(m[2] || 0), s = +(m[3] || 0);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(min).padStart(2, '0')}:${ss}` : `${min}:${ss}`;
}

// First match wins: lyric -> live -> official -> other. `fan-made` is never guessed.
function guessType(title, channel) {
  const t = String(title || '').toLowerCase(), c = String(channel || '').toLowerCase();
  if (/\blyrics?\b/.test(t)) return 'lyric';
  if (/\blive\b|\bconcert\b/.test(t)) return 'live';
  if (/\bofficial\b/.test(t) || /- topic$/.test(c) || /vevo$/.test(c)) return 'official';
  return 'other';
}

async function callApi(fetchImpl, path, params) {
  let res;
  try {
    res = await fetchImpl(`${API}/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw coded('UPSTREAM', 'could not reach YouTube'); // deliberately drops the error: its message/cause can hold the URL
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || 'unknown';
    console.warn(`youtube api ${path} failed: HTTP ${res.status} (${reason})`);
    const quota = reason === 'quotaExceeded' || reason === 'dailyLimitExceeded';
    throw coded(quota ? 'QUOTA' : 'UPSTREAM', `YouTube API error (HTTP ${res.status})`);
  }
  return body || {};
}

async function searchVideos(query, { fetchImpl = fetch, apiKey = process.env.YOUTUBE_API_KEY } = {}) {
  if (!apiKey) return { configured: false, candidates: [] };
  const s = await callApi(fetchImpl, 'search', {
    part: 'snippet', type: 'video', maxResults: String(MAX_RESULTS), q: query, key: apiKey,
  });
  const items = (s.items || []).filter(i => i.id && i.id.videoId);
  if (!items.length) return { configured: true, candidates: [] };
  const d = await callApi(fetchImpl, 'videos', {
    part: 'contentDetails,status', id: items.map(i => i.id.videoId).join(','), key: apiKey,
  });
  const byId = new Map((d.items || []).map(v => [v.id, v]));
  const candidates = items.map(i => {
    const id = i.id.videoId;
    const title = decodeEntities(i.snippet?.title);
    const channel = decodeEntities(i.snippet?.channelTitle);
    const det = byId.get(id);
    return {
      youtube_id: id,
      title,
      channel,
      thumbnail: i.snippet?.thumbnails?.medium?.url || `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
      duration: det ? formatDuration(det.contentDetails?.duration) : null,
      embeddable: det && typeof det.status?.embeddable === 'boolean' ? det.status.embeddable : null,
      suggested_type: guessType(title, channel),
    };
  });
  return { configured: true, candidates };
}

// The workbench entry point: query = "<artists> <title>", and each candidate is flagged when the
// song already has that video.
async function findCandidatesForSong(db, songId, opts = {}) {
  const song = (await db.query(`
    SELECT s.title, COALESCE(string_agg(DISTINCT a.name, ' '), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    WHERE s.id = $1
    GROUP BY s.id`, [songId])).rows[0];
  if (!song) throw coded('NOT_FOUND', 'song not found');
  const query = `${song.artists} ${song.title}`.trim();
  const result = await searchVideos(query, opts);
  const have = new Set((await db.query('SELECT youtube_id FROM youtube_videos WHERE song_id=$1', [songId]))
    .rows.map(r => r.youtube_id));
  return {
    configured: result.configured,
    query,
    candidates: result.candidates.map(c => ({ ...c, already_added: have.has(c.youtube_id) })),
  };
}

module.exports = { guessType, formatDuration, decodeEntities, searchVideos, findCandidatesForSong };
