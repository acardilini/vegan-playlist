// Effective-genre helpers (pure). Effective genre = the song's own genre when set,
// else its primary artist's first Spotify genre — computed at query time, never stored.
// Both /filter-options (counts) and /search (filtering) use the same expression so a
// genre's count always equals what clicking it returns.
const { getParentGenre, GENRE_HIERARCHY } = require('../utils/genreMapping');

// getParentGenre as SQL, for queue predicates that must compare parents inside a query. Generated from the
// one shared hierarchy (a parent maps to itself, each subgenre to its parent, anything else 'other'), so it
// cannot drift from getParentGenre. The VALUES list is static data from our own JSON, not user input.
const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const PARENT_VALUES_SQL = Object.entries(GENRE_HIERARCHY)
  .flatMap(([parent, subs]) => [[parent, parent], ...subs.map((s) => [s, parent])])
  .map(([g, p]) => `(${sqlLit(g)}, ${sqlLit(p)})`).join(', ');
function parentSql(expr) {
  return `COALESCE((SELECT m.pg_parent FROM (VALUES ${PARENT_VALUES_SQL}) AS m(pg_genre, pg_parent) WHERE m.pg_genre = LOWER(TRIM(${expr})) LIMIT 1), 'other')`;
}

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

const EFFECTIVE_GENRE_EXPR = `LOWER(TRIM(COALESCE(NULLIF(BTRIM(s.genre), ''), efg.g)))`;

// The same effective genre as EFFECTIVE_GENRE_EXPR, as a self-contained scalar subquery for a song aliased
// `s`: it needs no join, so it can be added to any list/detail query (song page, cards) whatever else that
// query joins. Keep the two in step - both are "the song's own genre, else its primary artist's first".
const EFFECTIVE_GENRE_SUBQUERY = `(SELECT LOWER(TRIM(COALESCE(NULLIF(BTRIM(s.genre), ''), (
    SELECT (a2.genres)[1] FROM song_artists sa2 JOIN artists a2 ON a2.id = sa2.artist_id
    WHERE sa2.song_id = s.id AND array_length(a2.genres, 1) > 0 ORDER BY sa2.id LIMIT 1)))))`;

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

// Artist filter sidebar: parent-genre counts. rows = [{artist_id, genre}] (one per artist/genre pair);
// an artist counts once under each parent any of their genres files under. Same getParentGenre as the
// song tree, so there is no second copy of the hierarchy to drift.
function artistParentCounts(rows) {
  const byParent = new Map(); // parent -> Set(artist_id)
  for (const { artist_id, genre } of rows) {
    const parent = getParentGenre(genre);
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, new Set());
    byParent.get(parent).add(artist_id);
  }
  return [...byParent.entries()]
    .map(([value, ids]) => ({ value, count: ids.size }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// The stored genre strings (as the artists table holds them) that file under any of the parents. Filtering
// on these, not on the hierarchy's lists, keeps 'other' honest: its count includes unlisted strings.
function genresForParents(allGenres, parents) {
  const want = new Set((parents || []).map(p => String(p).toLowerCase()));
  return allGenres.filter(g => want.has(getParentGenre(g)));
}

function genreFilterClause(genres, startIndex) {
  const list = (Array.isArray(genres) ? genres : [genres])
    .filter(Boolean).map(x => String(x).toLowerCase());
  if (list.length === 0) return null;
  return { clause: `${EFFECTIVE_GENRE_EXPR} = ANY($${startIndex}::text[])`, params: [list] };
}

// Fixed preset -> duration_ms range (ms). Values are constants, safe to inline into SQL.
const LENGTH_BUCKETS = [
  { value: 'short', label: 'Short (< 2 min)', min: 1, max: 120000 },
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
  EFFECTIVE_GENRE_JOIN, EFFECTIVE_GENRE_EXPR, EFFECTIVE_GENRE_SUBQUERY, parentSql,
  buildGenreTree, artistParentCounts, genresForParents, genreFilterClause, LENGTH_BUCKETS, lengthFilterClause,
};
