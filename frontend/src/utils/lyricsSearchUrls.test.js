import test from 'node:test';
import assert from 'node:assert/strict';
import { LYRIC_SITES, buildQuery, anywhereUrl, allSitesUrl, youtubeSearchUrl, siteUrl, sourceNameFromUrl } from './lyricsSearchUrls.js';

test('buildQuery quotes title and first artist and adds the word lyrics', () => {
  assert.equal(buildQuery({ title: 'Meat Is Murder', artist: 'The Smiths' }), '"Meat Is Murder" The Smiths lyrics');
});

test('buildQuery drops a missing artist rather than emitting empty quotes', () => {
  assert.equal(buildQuery({ title: 'Solo', artist: '' }), '"Solo" lyrics');
  assert.equal(buildQuery({ title: 'Solo' }), '"Solo" lyrics');
});

test('buildQuery strips double quotes and collapses whitespace', () => {
  assert.equal(buildQuery({ title: '  Say  "No"  ', artist: 'A' }), '"Say No" A lyrics');
});

test('allSitesUrl is one Google URL with every site OR-ed and the query encoded', () => {
  const u = new URL(allSitesUrl({ title: 'Rock & Roll #1', artist: 'Sigur Rós' }));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/search');
  const q = u.searchParams.get('q');
  assert.ok(q.startsWith('"Rock & Roll #1" Sigur Rós lyrics ('));
  for (const s of LYRIC_SITES) assert.ok(q.includes(`site:${s.host}`), s.host);
  assert.equal((q.match(/ OR /g) || []).length, LYRIC_SITES.length - 1);
});

test('anywhereUrl is an unrestricted Google search: quoted title, plain artist, no site: terms', () => {
  const u = new URL(anywhereUrl({ title: 'No Torture', artist: 'Decontrol' }));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/search');
  assert.equal(u.searchParams.get('q'), '"No Torture" Decontrol lyrics');
});

test('siteUrl uses a site search URL when it has one, else a single-site Google query', () => {
  const withSearch = LYRIC_SITES.find((s) => s.search);
  const without = LYRIC_SITES.find((s) => !s.search);
  assert.ok(withSearch && without, 'list has both kinds');
  assert.ok(siteUrl(withSearch, { title: 'T', artist: 'A' }).startsWith('https://'));
  const g = new URL(siteUrl(without, { title: 'T', artist: 'A' }));
  assert.equal(g.hostname, 'www.google.com');
  assert.ok(g.searchParams.get('q').endsWith(` site:${without.host}`));
});

test('every site declares a known avenue', () => {
  for (const s of LYRIC_SITES) assert.ok(['genius', 'bandcamp', 'genre_site'].includes(s.avenue), s.key);
});

test('sourceNameFromUrl maps known hosts to display names and falls back to the bare hostname', () => {
  assert.equal(sourceNameFromUrl('https://www.azlyrics.com/lyrics/x/y.html'), 'AZLyrics');
  assert.equal(sourceNameFromUrl('https://genius.com/Band-song-lyrics'), 'Genius');
  assert.equal(sourceNameFromUrl('https://someband.bandcamp.com/track/x'), 'Bandcamp');
  assert.equal(sourceNameFromUrl('https://www.example.org/page'), 'example.org');
});

test('sourceNameFromUrl returns empty for blank, garbage and non-http input', () => {
  for (const v of ['', '  ', null, undefined, 'not a url', 'ftp://x.org/a', 'javascript:alert(1)']) {
    assert.equal(sourceNameFromUrl(v), '', String(v));
  }
});

test('siteUrl percent-encodes reserved characters in title and artist', () => {
  const genius = LYRIC_SITES.find((s) => s.key === 'genius');
  const u = siteUrl(genius, { title: 'A&B #1', artist: 'Sigur Rós' });
  assert.ok(u.includes('A%26B%20%231'), u);
  assert.ok(u.includes('Sigur%20R%C3%B3s'), u);
  assert.ok(!u.includes('#'), u);
});

test('sourceNameFromUrl does not treat a look-alike host as a known site', () => {
  assert.equal(sourceNameFromUrl('https://notgenius.com/x'), 'notgenius.com');
});

test('URLs with no artist contain no empty quoted pair', () => {
  const song = { title: 'Solo' };
  const urls = [anywhereUrl(song), allSitesUrl(song), ...LYRIC_SITES.map((s) => siteUrl(s, song))];
  for (const u of urls) {
    assert.ok(!u.includes('%22%22') && !decodeURIComponent(u.replace(/\+/g, ' ')).includes('""'), u);
  }
});

test('youtubeSearchUrl encodes title and artist into a YouTube results URL', () => {
  const u = new URL(youtubeSearchUrl({ title: 'A&B #1', artist: 'Sigur Rós' }));
  assert.equal(u.origin + u.pathname, 'https://www.youtube.com/results');
  assert.equal(u.searchParams.get('search_query'), 'A&B #1 Sigur Rós');
});
