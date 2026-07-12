const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The full-lyrics table (song_lyrics.lyrics/.translation) is LOCAL ONLY. Only admin.js
// (behind auth) may reference it. Guard against a public route ever SELECTing it.
const PUBLIC_ROUTES = ['spotify.js', 'playlists.js', 'youtube.js', 'submissions.js', 'analytics.js'];

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
