// DB-level cover for the multi-language browse behaviour: a bilingual song must be
// findable under EITHER language and counted under BOTH. The facet SQL below mirrors
// the canonical copy in routes/spotify.js (/filter-options, /browse-facets); the live
// smoke in the plan's final task is the anti-drift check on that duplication.
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const browse = require('../services/browseFilters');

const PREFIX = 'ZZZLNG';
after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE '${PREFIX}%'`);
  await pool.end();
});

async function mkBilingual() {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, language)
     VALUES ('${PREFIX} Bilingual', 'included', true, 'manual', ARRAY['ZZZLNGPor','ZZZLNGEng'])
     RETURNING id`)).rows[0].id;
}

test('a bilingual song is returned when filtering by either of its languages', async () => {
  const id = await mkBilingual();
  for (const lang of ['ZZZLNGPor', 'ZZZLNGEng']) {
    const bw = browse.buildWhere({ languages: [lang] }, { startIndex: 1 });
    const r = await pool.query(
      `SELECT s.id FROM songs s${browse.joinSql(bw.joins)}
       WHERE s.status='included' AND s.published=true AND ${bw.where.join(' AND ')}`, bw.params);
    assert.ok(r.rows.some((row) => row.id === id), `found under ${lang}`);
  }
});

test('a bilingual song counts under both languages in the unnest facet', async () => {
  await mkBilingual();
  const r = await pool.query(`
    SELECT lang AS value, COUNT(*)::int AS count
    FROM songs s, unnest(s.language) AS lang
    WHERE s.status = 'included' AND s.published = true
    GROUP BY lang`);
  const por = r.rows.find((x) => x.value === 'ZZZLNGPor');
  const eng = r.rows.find((x) => x.value === 'ZZZLNGEng');
  assert.ok(por && por.count >= 1, 'counted under its first language');
  assert.ok(eng && eng.count >= 1, 'counted under its second language');
});
