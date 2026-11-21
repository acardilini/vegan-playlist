const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A guard, not a feature test: the Spotify-era audio features and the first acoustic analysis were retired when the
// site switched to song_audio_analysis (Step B). This fails if any of those names creeps back into the code the site
// runs - routes, services, utils and the whole frontend source. Pure file scan: no DB, no fixtures.

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['backend/routes', 'backend/services', 'backend/utils', 'frontend/src'];
const RETIRED = [
  'sonic_energy', 'emotional_mood', 'rhythmic_style', 'acoustic_type', 'vocal_delivery',
  'acoustic_facets', 'acousticFacets', 'acousticSelectionClauses',
  's.energy', 's.danceability', 's.valence', 'custom_mood', 'audioFeatures',
];

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* sourceFiles(full);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

test('no retired audio name appears in the routes, services, utils or frontend source', () => {
  const hits = [];
  for (const d of DIRS) {
    for (const file of sourceFiles(path.join(ROOT, d))) {
      // The frontend tests deliberately name a retired URL key to prove it is ignored.
      if (/\.test\.jsx?$/.test(file)) continue;
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        for (const name of RETIRED) {
          if (line.includes(name)) hits.push(`${path.relative(ROOT, file)}:${i + 1}  ${name}`);
        }
      });
    }
  }
  assert.deepEqual(hits, [], `retired audio names are back:\n${hits.join('\n')}`);
});

test('the guard scans real files (it would pass vacuously on a wrong path)', () => {
  const n = DIRS.reduce((total, d) => total + [...sourceFiles(path.join(ROOT, d))].length, 0);
  assert.ok(n > 50, `scanned ${n} files`);
});
