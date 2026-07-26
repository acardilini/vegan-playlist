// Shared browse filter builder. buildWhere returns per-group-tagged WHERE clauses so
// /search (all groups) and /browse-facets (all groups minus one, for exclude-self counts)
// share one source and can never drift. `where` omits the status/published clause — each
// caller prepends it. Booleans arrive as the string 'true'.
const genres_svc = require('./genres');
const analysis = require('./analysis');
const codebook = require('./metadataCodebook');
const acousticCodebook = require('./acousticCodebook');

function asList(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

function buildWhere(filters, { exclude = null, startIndex = 1 } = {}) {
  const where = [];
  const params = [];
  let idx = startIndex;
  // scalarAnalysis === the `sca` LATEST_ANALYSIS join. Shared by the scalar metadata
  // components AND the acoustic dimensions — they are columns on the same row.
  const joins = { albums: false, artists: false, effectiveGenre: false, analysis: false, scalarAnalysis: false };
  const inc = (g) => g !== exclude;

  const q = (filters.q || '').trim();
  if (q) {
    where.push(`(LOWER(s.title) LIKE LOWER($${idx}) OR LOWER(a.name) LIKE LOWER($${idx}) OR LOWER(al.name) LIKE LOWER($${idx}) OR LOWER(s.your_review) LIKE LOWER($${idx}))`);
    params.push(`%${q}%`); idx++;
    joins.albums = true; joins.artists = true;
  }
  if (filters.year_from) { where.push(`EXTRACT(YEAR FROM al.release_date) >= $${idx}`); params.push(parseInt(filters.year_from)); idx++; joins.albums = true; }
  if (filters.year_to)   { where.push(`EXTRACT(YEAR FROM al.release_date) <= $${idx}`); params.push(parseInt(filters.year_to)); idx++; joins.albums = true; }

  if (inc('genre') && asList(filters.genres).length) {
    const gf = genres_svc.genreFilterClause(filters.genres, idx);
    if (gf) { where.push(gf.clause); params.push(...gf.params); idx += gf.params.length; joins.effectiveGenre = true; }
  }
  if (inc('length') && asList(filters.lengths).length) {
    const lc = genres_svc.lengthFilterClause(filters.lengths);
    if (lc) where.push(lc);
  }
  if (inc('available')) {
    if (filters.on_spotify === 'true') where.push(`s.spotify_id IS NOT NULL AND s.spotify_id <> ''`);
    if (filters.has_youtube === 'true') where.push(`EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id)`);
  }
  if (inc('analysis_toggle') && filters.has_analysis === 'true') {
    where.push(analysis.hasAnalysisExists('s'));
  }
  if (inc('language') && asList(filters.languages).length) {
    where.push(`s.language && $${idx}::text[]`); params.push(asList(filters.languages)); idx++;
  }
  if (inc('analysis')) {
    const sel = {
      codes: {
        themes: filters.themes, targets: filters.targets, actions: filters.actions,
        tactics: filters.tactics, moral_frames: filters.moral_frames,
      },
      groups: filters.facet_groups,
      subdims: filters.facet_subdims,
    };
    const f = analysis.facetSelectionClauses(sel, idx);
    if (f.needsJoin) { where.push(...f.clauses); params.push(...f.params); idx += f.params.length; joins.analysis = true; }
  }

  // Scalar metadata components — one exclude-self group per component, so an open
  // sidebar group stays widenable. OR within a component, AND across (spec 2026-07-22).
  const scalarSel = {};
  for (const c of codebook.COMPONENTS) {
    if (inc(`scalar:${c.key}`)) scalarSel[c.key] = filters[c.key];
  }
  const sc = codebook.scalarSelectionClauses(scalarSel, idx);
  if (sc.needsJoin) {
    where.push(...sc.clauses);
    params.push(...sc.params);
    idx = sc.nextIndex;
    joins.scalarAnalysis = true;
  }

  // Acoustic dimensions — same latest-analysis row as the scalar components, so they reuse
  // the `sca` join and add none of their own. OR within a component, AND across.
  const acousticSel = {};
  for (const c of acousticCodebook.COMPONENTS) {
    if (inc(`acoustic:${c.key}`)) acousticSel[c.key] = filters[c.key];
  }
  const ac = acousticCodebook.acousticSelectionClauses(acousticSel, idx);
  if (ac.needsJoin) {
    where.push(...ac.clauses);
    params.push(...ac.params);
    idx = ac.nextIndex;
    joins.scalarAnalysis = true;
  }

  // Tempo is a range, not an enum: always applied (it has no facet counts of its own to
  // protect), exactly like year_from/year_to.
  if (filters.tempo_from) {
    where.push(`sca.tempo_bpm >= $${idx}`); params.push(parseInt(filters.tempo_from, 10));
    idx++; joins.scalarAnalysis = true;
  }
  if (filters.tempo_to) {
    where.push(`sca.tempo_bpm <= $${idx}`); params.push(parseInt(filters.tempo_to, 10));
    idx++; joins.scalarAnalysis = true;
  }

  return { where, params, nextIndex: idx, joins };
}

// FROM-clause joins for a browse-facets COUNT query. /search keeps its own fixed FROM.
function joinSql(joins) {
  let s = '';
  if (joins.albums) s += ` LEFT JOIN albums al ON s.album_id = al.id`;
  if (joins.artists) s += ` JOIN song_artists sart ON s.id = sart.song_id JOIN artists a ON sart.artist_id = a.id`;
  if (joins.effectiveGenre) s += ` ${genres_svc.EFFECTIVE_GENRE_JOIN}`;
  if (joins.analysis) s += ` JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id`;
  if (joins.scalarAnalysis) s += ` JOIN ${analysis.LATEST_ANALYSIS} sca ON sca.song_id = s.id`;
  return s;
}

const SORT_COLUMNS = {
  title:      { expr: 's.title',                                    def: 'ASC',  nulls: '' },
  artist:     { expr: 'MIN(a.name)',                                def: 'ASC',  nulls: '' },
  year:       { expr: 'al.release_date',                            def: 'DESC', nulls: ' NULLS LAST' },
  date_added: { expr: 'COALESCE(s.playlist_added_at, s.date_added)', def: 'DESC', nulls: ' NULLS LAST' },
};

// Pure ORDER BY builder. `dir` is whitelisted to asc/desc; anything else uses the
// field default. Unknown fields fall back to the popularity default.
function buildOrderBy(sortBy, dir) {
  const col = SORT_COLUMNS[sortBy];
  if (!col) return 'ORDER BY s.popularity DESC, s.title ASC';
  const d = dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : col.def;
  const tiebreak = sortBy === 'title' ? '' : ', s.title ASC';
  return `ORDER BY ${col.expr} ${d}${col.nulls}${tiebreak}`;
}

module.exports = { buildWhere, joinSql, buildOrderBy };
