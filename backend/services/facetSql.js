// Small SQL helpers shared by the facet-count builders (analysis.js and audioAnalysis.js), kept here so neither
// service has to import the other.

// Unpack a per-component constraint {joinSql, where, params} into ready-to-splice SQL fragments. A missing/null
// constraint degrades to no extra join, where or params.
function unpackConstraint(cn) {
  cn = cn || {};
  return {
    joinSql: cn.joinSql || '',
    whereSql: (cn.where && cn.where.length) ? ' AND ' + cn.where.join(' AND ') : '',
    params: cn.params || [],
  };
}

// Count distinct live songs per code. `inner` is a SELECT yielding (song_id, code) rows; each caller owns its own
// inner query because array columns must be unnested while plain ones are read directly.
async function countByCode(db, inner, params) {
  const rows = (await db.query(
    `SELECT code, COUNT(DISTINCT song_id)::int AS count FROM (${inner}) t
     WHERE code IS NOT NULL GROUP BY code`, params)).rows;
  return new Map(rows.map(r => [r.code, r.count]));
}

module.exports = { unpackConstraint, countByCode };
