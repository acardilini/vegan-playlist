const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const audio = require('../services/audioAnalysis');

// Unique fixture sentinel for this file: ZZZATL.
// The song page's audio timeline: the 80-bin `audio_timeline` curves, `sonic_evidence` parsed into timed sections,
// sample spans in seconds, and named attribution only at HIGH identification confidence.

const curve = (v) => Array.from({ length: 80 }, () => v);
const TIMELINE = { version: 'v1', bins: 80, duration_sec: 186, bin_sec: 2.325, loudness: curve(0.5), grit: curve(0.4), pulse: curve(0.9) };

// ---- parseSections (pure) ----

test('parseSections reads "M:SS-M:SS: text", "M:SS–M:SS text" (en dash) and "M:SS text" lines', () => {
  const out = audio.parseSections([
    '0:00-0:48: Dark ambient pads under a calm narration.',
    '0:48–1:10 Heavy guitars enter.',
    '1:11 A mournful melody swells.',
  ], 112);
  assert.deepEqual(out, [
    { startSec: 0, endSec: 48, label: '0:00–0:48', text: 'Dark ambient pads under a calm narration.' },
    { startSec: 48, endSec: 70, label: '0:48–1:10', text: 'Heavy guitars enter.' },
    { startSec: 71, endSec: 112, label: '1:11–1:52', text: 'A mournful melody swells.' },
  ]);
});

test('a single-timestamp section ends where the next begins, or at the duration for the last one', () => {
  const out = audio.parseSections(['0:10 One.', '0:40 Two.', '1:00 Three.'], 90);
  assert.deepEqual(out.map((s) => [s.startSec, s.endSec]), [[10, 40], [40, 60], [60, 90]]);
});

test('minutes past 59 and a missing duration are handled; an end before the start is clamped to the start', () => {
  assert.equal(audio.parseSections(['75:10-76:00 Long.'], null)[0].startSec, 75 * 60 + 10);
  assert.equal(audio.parseSections(['0:30 Only.'], null)[0].endSec, null, 'no duration, no next section: open-ended');
  const odd = audio.parseSections(['1:00-0:30 Backwards.'], 120)[0];
  assert.equal(odd.endSec, odd.startSec);
});

test('lines with no timestamp survive as untimed notes; non-strings and blanks are dropped; non-arrays give []', () => {
  const out = audio.parseSections(['Just a note.', '', null, 42, { a: 1 }], 100);
  assert.deepEqual(out, [{ startSec: null, endSec: null, label: null, text: 'Just a note.' }]);
  for (const bad of [null, undefined, 'text', {}, 7]) assert.deepEqual(audio.parseSections(bad, 100), []);
});

// ---- parseRange (pure) ----

test('parseRange turns a sample timestamp into seconds', () => {
  assert.deepEqual(audio.parseRange('0:44-1:19'), { startSec: 44, endSec: 79 });
  assert.deepEqual(audio.parseRange('1:56–1:57'), { startSec: 116, endSec: 117 });
  assert.deepEqual(audio.parseRange('2:00'), { startSec: 120, endSec: 120 }, 'a lone time is a point');
  assert.deepEqual(audio.parseRange('3:10-2:50'), { startSec: 190, endSec: 190 }, 'a backwards range collapses to its start');
  for (const bad of [null, undefined, '', 'soon', '12', {}]) assert.deepEqual(audio.parseRange(bad), { startSec: null, endSec: null });
});

// ---- cleanTimeline (pure) ----

test('cleanTimeline accepts a v1 timeline and rejects anything malformed', () => {
  assert.deepEqual(audio.cleanTimeline(TIMELINE), TIMELINE);
  assert.equal(audio.cleanTimeline(null), null);
  assert.equal(audio.cleanTimeline({ ...TIMELINE, version: 'v2' }), null, 'unknown version');
  assert.equal(audio.cleanTimeline({ ...TIMELINE, grit: curve(0.4).slice(1) }), null, 'a curve of the wrong length');
  assert.equal(audio.cleanTimeline({ ...TIMELINE, pulse: [...curve(0.4).slice(1), 'x'] }), null, 'a non-number');
  assert.equal(audio.cleanTimeline({ ...TIMELINE, duration_sec: 0 }), null, 'no duration');
  assert.equal(audio.cleanTimeline({ ...TIMELINE, bins: 79 }), null, 'bins must equal the curve length');
  const clamped = audio.cleanTimeline({ ...TIMELINE, loudness: [1.4, -0.2, ...curve(0.5).slice(2)] });
  assert.deepEqual(clamped.loudness.slice(0, 2), [1, 0], 'values outside 0..1 are clamped');
});

// ---- the DB-backed blocks ----

async function mkSong(title, { show = null } = {}) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, show_audio_samples) VALUES ($1,'included',true,'manual',$2) RETURNING id`,
    [title, show])).rows[0].id;
}

const DETAILS = [
  { type: 'ADVOCATE_SPEECH_CLIP', timestamp: '0:44-1:19', description: 'A speech.', speaker_or_source: 'Ed Winters', transcript_excerpt: 'Now is the time.', identification_confidence: 'HIGH' },
  { type: 'ADVOCATE_SPEECH_CLIP', timestamp: '2:31-2:54', description: 'Chants.', speaker_or_source: 'A Person', transcript_excerpt: 'Say it out loud.', identification_confidence: 'UNIDENTIFIED' },
  { type: 'ANIMAL_SLAUGHTER_SFX', timestamp: '1:56-1:57', description: 'A bolt.', speaker_or_source: 'A Named Plant', transcript_excerpt: null },
];

async function addAudio(songId, { timeline = TIMELINE, evidence = ['0:00-0:48: Intro.', '0:48-3:06: The rest.'], details = DETAILS, model = 'zzzatl-audio' } = {}) {
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, musical_mood, audio_samples, sample_details, sonic_evidence, audio_timeline, sonic_summary)
     VALUES ($1,$2,'OK','2026-11-01 10:00:00',ARRAY['DARK_OMINOUS'],ARRAY['ADVOCATE_SPEECH_CLIP','ANIMAL_SLAUGHTER_SFX'],$3::jsonb,$4::jsonb,$5::jsonb,'A track.')`,
    [songId, model, JSON.stringify(details), JSON.stringify(evidence), timeline ? JSON.stringify(timeline) : null]);
}

test('the public block carries the timeline and timed sections, with no samples until approved', async () => {
  const id = await mkSong('ZZZATL Unapproved');
  await addAudio(id);
  const block = await audio.getSongAudio(pool, id);
  assert.deepEqual(block.timeline, TIMELINE);
  assert.equal(block.sections.length, 2);
  assert.equal(block.sections[1].endSec, 186, 'the 0:48-3:06 line ends at 3:06');
  assert.equal(block.samples, null, 'the sample gate is unchanged');
  assert.ok(!JSON.stringify(block).includes('Ed Winters') && !JSON.stringify(block).includes('Now is the time'), 'nothing from sample_details leaks');
});

test('an approved song serves sample spans in seconds, and names a source only at HIGH confidence', async () => {
  const id = await mkSong('ZZZATL Approved', { show: true });
  await addAudio(id);
  const items = (await audio.getSongAudio(pool, id)).samples.items;
  assert.deepEqual([items[0].startSec, items[0].endSec], [44, 79]);
  assert.equal(items[0].source, 'Ed Winters');
  assert.equal(items[0].confidence, 'HIGH');
  assert.equal(items[1].source, null, 'UNIDENTIFIED: no name');
  assert.equal(items[1].confidence, 'UNIDENTIFIED');
  assert.equal(items[1].transcript, 'Say it out loud.', 'the transcript is still shown');
  assert.equal(items[2].source, null, 'a missing confidence is not HIGH');
  assert.equal(items[2].confidence, null);
  assert.ok(!JSON.stringify(items).includes('A Person') && !JSON.stringify(items).includes('A Named Plant'), 'the withheld names are not in the payload at all');
});

test('the curator view has the timeline and every sample whatever the gate says', async () => {
  const id = await mkSong('ZZZATL Admin');
  await addAudio(id);
  const block = await audio.getAdminAudio(pool, id);
  assert.deepEqual(block.timeline, TIMELINE);
  assert.equal(block.samples.items.length, 3);
  assert.equal(block.samples.items[0].startSec, 44);
});

test('a song with no timeline (or a malformed one) serves timeline null and everything else as before', async () => {
  const none = await mkSong('ZZZATL NoTimeline');
  await addAudio(none, { timeline: null });
  const bad = await mkSong('ZZZATL BadTimeline');
  await addAudio(bad, { timeline: { ...TIMELINE, version: 'v9' } });
  for (const id of [none, bad]) {
    const block = await audio.getSongAudio(pool, id);
    assert.equal(block.timeline, null);
    assert.equal(block.summary, 'A track.');
    assert.equal(block.sections.length, 2, 'sections do not depend on the timeline');
  }
});

test('the single-song payload is the only place the timeline travels: list reads never select it', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['../routes/spotify.js', '../services/explore.js', '../services/browseFilters.js']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, f), 'utf8').includes('audio_timeline'), `${f} must not read audio_timeline`);
  }
});

after(async () => {
  await pool.query(`DELETE FROM song_audio_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZATL%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZATL%'`);
  await pool.end();
});
