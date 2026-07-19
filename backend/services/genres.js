// Effective-genre helpers (pure). Effective genre = the song's own genre when set,
// else its primary artist's first Spotify genre — computed at query time, never stored.
// Both /filter-options (counts) and /search (filtering) use the same expression so a
// genre's count always equals what clicking it returns.
const { getParentGenre } = require('../utils/genreMapping');

// Primary artist's first genre for a song aliased `s`, exposed as efg.g.
// "Primary" = the linked artist with the lowest song_artists.id that has genres.
const EFFECTIVE_GENRE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT (a2.genres)[1] AS g
    FROM song_artists sa2
    JOIN artists a2 ON a2.id = sa2.artist_id
    WHERE sa2.song_id = s.id AND array_length(a2.genres, 1) > 0
    ORDER BY sa2.id
    LIMIT 1
  ) efg ON true`;

const EFFECTIVE_GENRE_EXPR = `LOWER(COALESCE(NULLIF(s.genre, ''), efg.g))`;

function buildGenreTree(rows) {
  const parents = new Map(); // parent -> Map(subgenre -> count)
  let uncovered = 0;
  for (const row of rows) {
    const raw = row.effective_genre;
    const gk = raw ? String(raw).toLowerCase().trim() : '';
    if (!gk) { uncovered++; continue; }
    const parent = getParentGenre(gk); // 'other' when unmapped
    if (!parents.has(parent)) parents.set(parent, new Map());
    const subs = parents.get(parent);
    subs.set(gk, (subs.get(gk) || 0) + 1);
  }
  const out = [];
  for (const [parent, subs] of parents) {
    const subgenres = [...subs.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    out.push({ value: parent, count: subgenres.reduce((s, x) => s + x.count, 0), subgenres });
  }
  out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { parents: out, uncovered_count: uncovered };
}

function genreFilterClause(genres, startIndex) {
  const list = (Array.isArray(genres) ? genres : [genres])
    .filter(Boolean).map(x => String(x).toLowerCase());
  if (list.length === 0) return null;
  return { clause: `${EFFECTIVE_GENRE_EXPR} = ANY($${startIndex}::text[])`, params: [list] };
}

// Fixed preset -> duration_ms range (ms). Values are constants, safe to inline into SQL.
const LENGTH_BUCKETS = [
  { value: 'short', label: 'Short (< 2 min)', min: null, max: 120000 },
  { value: 'medium', label: 'Medium (2–4 min)', min: 120000, max: 240000 },
  { value: 'long', label: 'Long (4+ min)', min: 240000, max: null },
];

function lengthFilterClause(lengths) {
  const keys = (Array.isArray(lengths) ? lengths : [lengths]).filter(Boolean);
  const buckets = LENGTH_BUCKETS.filter(b => keys.includes(b.value));
  if (buckets.length === 0) return null;
  const parts = buckets.map(b => {
    const c = [];
    if (b.min != null) c.push(`s.duration_ms >= ${b.min}`);
    if (b.max != null) c.push(`s.duration_ms < ${b.max}`);
    return `(${c.join(' AND ')})`;
  });
  return `(${parts.join(' OR ')})`;
}

module.exports = {
  EFFECTIVE_GENRE_JOIN, EFFECTIVE_GENRE_EXPR,
  buildGenreTree, genreFilterClause, LENGTH_BUCKETS, lengthFilterClause,
};
