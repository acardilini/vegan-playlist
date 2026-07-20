// Persistence for curator-rejected duplicate pairs (migration 008).
const { pairKey } = require('./duplicates');

async function getDismissedPairKeys(db) {
  const r = await db.query('SELECT song_id_a, song_id_b FROM duplicate_dismissals');
  return new Set(r.rows.map((x) => `${x.song_id_a}:${x.song_id_b}`)); // rows already stored a<b
}

// Records every unordered pair among songIds as dismissed. Returns the count of
// distinct valid ids considered.
async function dismissGroup(db, songIds) {
  const ids = [...new Set((songIds || []).map(Number))].filter(Number.isInteger);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = Math.min(ids[i], ids[j]);
      const b = Math.max(ids[i], ids[j]);
      await db.query(
        'INSERT INTO duplicate_dismissals (song_id_a, song_id_b) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [a, b]);
    }
  }
  return ids.length;
}

module.exports = { getDismissedPairKeys, dismissGroup, pairKey };
