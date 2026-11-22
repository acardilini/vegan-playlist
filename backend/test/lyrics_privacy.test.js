const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The full-lyrics table (song_lyrics.lyrics/.translation) is LOCAL ONLY. Only admin.js
// (behind auth) may reference it. Guard against a public route ever SELECTing it.
const PUBLIC_ROUTES = ['spotify.js', 'playlists.js', 'youtube.js', 'submissions.js', 'analytics.js', 'analysis.js', 'content.js'];

test('no public route references song_lyrics', () => {
  for (const f of PUBLIC_ROUTES) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.ok(!/song_lyrics/.test(src), `${f} must not reference song_lyrics`);
  }
});

test('no public route references the translation column', () => {
  for (const f of PUBLIC_ROUTES) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.ok(!/\btranslation\b/.test(src), `${f} must not reference translation`);
  }
});

// The AI draft transcripts (song_audio_transcripts.transcript) are the same kind of text as lyrics: LOCAL / ADMIN ONLY.
// Only services/curation.js (the admin workbench) may read the table; no route file and no other service may mention it,
// so a public route can never select a transcript directly or through a shared service.
const ADMIN_ONLY_SERVICES = ['curation.js'];

test('only the admin curation service references song_audio_transcripts', () => {
  const dirs = ['routes', 'services', 'utils'];
  let scanned = 0;
  for (const d of dirs) {
    const dir = path.join(__dirname, '..', d);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      if (d === 'services' && ADMIN_ONLY_SERVICES.includes(f)) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!/song_audio_transcripts/.test(src), `${d}/${f} must not reference song_audio_transcripts`);
      scanned++;
    }
  }
  assert.ok(scanned > 20, 'the scan actually covered the source files');
});

test('the admin curation service is the one place that reads it, and only behind the workbench', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'curation.js'), 'utf8');
  assert.ok(/song_audio_transcripts/.test(src), 'guard is not vacuous');
  for (const f of PUBLIC_ROUTES) {
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.ok(!/services\/curation/.test(route), `${f} must not import the admin curation service`);
  }
});
