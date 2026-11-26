const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZCKT (song titles). Fixture songs are never published, so no public read can see them;
// deleting a song cascades its transcript row. The main fixtures are titled 'ZZZCKT main <letter>' so a list call with
// q 'ZZZCKT main' sees exactly them among the real queue rows.

const SECRET = 'ZZZCKT the draft words that must never leave the admin API';
const NOTES = 'ZZZCKT-notes-secret the analysis note that must not reach a list row';
const Q = 'ZZZCKT main';

async function mkSong(title) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,'included',false,'manual') RETURNING id`, [title])).rows[0].id;
}
async function addTranscript(songId, o = {}) {
  const { status = 'OK', confidence = 'MEDIUM', score = null, accuracy = null, clarity = null, inaudible = null,
    notes = NOTES, text = SECRET, model = 'zzzckt-m', at = '2026-11-02 10:00:00' } = o;
  await pool.query(
    `INSERT INTO song_audio_transcripts (song_id, model_used, youtube_id_used, status, transcript, detected_languages, word_count,
       confidence, confidence_score, estimated_word_accuracy_pct, audio_clarity, inaudible_segments, confidence_notes, transcribed_at)
     VALUES ($1,$2,'abc123DEF45',$3,$4,ARRAY['English']::text[],100,$5,$6,$7,$8,$9,$10,$11)`,
    [songId, model, status, text, confidence, score, accuracy, clarity, inaudible, notes, at]);
}
const list = (o = {}) => curation.listCurationQueue(pool, { queue: 'check-transcripts', q: Q, ...o });
const ids = async (o) => (await list(o)).rows.map((r) => r.id);

let A, B, C, D, F;
async function clean() {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZCKT%'`);
}
before(async () => {
  await clean();
  A = await mkSong('ZZZCKT main A'); await addTranscript(A, { confidence: 'HIGH', score: 95, accuracy: 96, clarity: 'CLEAR', inaudible: 0 });
  B = await mkSong('ZZZCKT main B'); await addTranscript(B, { confidence: 'HIGH' }); // an older spoken-word row: no score, no details
  C = await mkSong('ZZZCKT main C'); await addTranscript(C, { confidence: 'MEDIUM', score: 70, clarity: 'MODERATE' });
  D = await mkSong('ZZZCKT main D'); await addTranscript(D, { confidence: 'LOW', score: 40, clarity: 'MUDDY_OR_BURIED', inaudible: 6 });
  F = await mkSong('ZZZCKT main F'); await addTranscript(F, { status: 'UNINTELLIGIBLE', confidence: 'LOW', score: 10, clarity: 'EXTREME_UNINTELLIGIBLE', inaudible: 12 });
  const blank = await mkSong('ZZZCKT main blank'); await addTranscript(blank, { status: 'UNINTELLIGIBLE', confidence: 'LOW', score: 5, text: '   ' });
});
after(async () => { await clean(); await pool.end(); });

test('an UNINTELLIGIBLE draft is in the queue with its own tier; a blank-text one is not', async () => {
  const rows = (await list()).rows;
  const f = rows.find((r) => r.id === F);
  assert.ok(f, 'the unintelligible draft is listed');
  assert.equal(f.transcript.tier, 'UNINTELLIGIBLE');
  assert.equal(rows.some((r) => r.title === 'ZZZCKT main blank'), false);
  assert.equal(rows.find((r) => r.id === A).transcript.tier, 'HIGH');
});

test('best puts the tiers high to low and an unscored HIGH above a scored LOW; worst reverses; no sort is by id', async () => {
  assert.deepEqual(await ids({ sort: 'best' }), [A, B, C, D, F]);
  assert.deepEqual(await ids({ sort: 'worst' }), [F, D, C, B, A]);
  assert.deepEqual(await ids(), [A, B, C, D, F].sort((x, y) => x - y));
});

test('the tier filter returns only that tier, unscored rows included', async () => {
  assert.deepEqual((await ids({ tier: 'HIGH', sort: 'best' })), [A, B]);
  assert.deepEqual(await ids({ tier: 'UNINTELLIGIBLE' }), [F]);
  assert.deepEqual(await ids({ tier: 'LOW' }), [D]);
});

test('paging with a sort is stable: pages are disjoint and together equal the whole list', async () => {
  const p1 = await ids({ sort: 'best', limit: 2, offset: 0 });
  const p2 = await ids({ sort: 'best', limit: 2, offset: 2 });
  const p3 = await ids({ sort: 'best', limit: 2, offset: 4 });
  assert.deepEqual([...p1, ...p2, ...p3], [A, B, C, D, F]);
});

test('the row carries the six confidence fields, nulls kept', async () => {
  const rows = (await list()).rows;
  assert.deepEqual(rows.find((r) => r.id === D).transcript, {
    tier: 'LOW', confidence: 'LOW', confidence_score: 40, estimated_word_accuracy_pct: null, audio_clarity: 'MUDDY_OR_BURIED', inaudible_segments: 6,
  });
  assert.deepEqual(rows.find((r) => r.id === B).transcript, {
    tier: 'HIGH', confidence: 'HIGH', confidence_score: null, estimated_word_accuracy_pct: null, audio_clarity: null, inaudible_segments: null,
  });
});

test('a bad sort or tier, or either on another queue, is BAD_QUEUE', async () => {
  const bad = { code: 'BAD_QUEUE' };
  await assert.rejects(list({ sort: 'sideways' }), bad);
  await assert.rejects(list({ tier: 'EXTREME' }), bad);
  await assert.rejects(curation.listCurationQueue(pool, { queue: 'needs-lyrics', sort: 'best' }), bad);
  await assert.rejects(curation.listCurationQueue(pool, { queue: 'needs-lyrics', tier: 'HIGH' }), bad);
});

test('list rows never carry the transcript text or the analysis notes', async () => {
  const json = JSON.stringify((await list()).rows);
  assert.ok(!json.includes('must never leave'), 'no transcript text');
  assert.ok(!json.includes('notes-secret'), 'no confidence notes');
});

test('the queue count matches the unfiltered list (the unintelligible drafts are counted)', async () => {
  const counts = await curation.queueCounts(pool);
  const all = await curation.listCurationQueue(pool, { queue: 'check-transcripts' });
  assert.equal(counts['check-transcripts'], all.rows.length);
  assert.ok(all.rows.some((r) => r.id === F));
});

// ---- the workbench draft ----

test('the draft carries the confidence details of its transcript row', async () => {
  const d = (await curation.getWorkbench(pool, A)).draft_transcript;
  assert.equal(d.transcript, SECRET);
  assert.deepEqual(
    [d.status, d.tier, d.confidence, d.confidence_score, d.estimated_word_accuracy_pct, d.audio_clarity, d.inaudible_segments, d.confidence_notes],
    ['OK', 'HIGH', 'HIGH', 95, 96, 'CLEAR', 0, NOTES]);
});

test('an UNINTELLIGIBLE transcript is a draft with its own tier', async () => {
  const d = (await curation.getWorkbench(pool, F)).draft_transcript;
  assert.ok(d, 'the unintelligible draft is offered');
  assert.deepEqual([d.status, d.tier, d.confidence, d.confidence_score], ['UNINTELLIGIBLE', 'UNINTELLIGIBLE', 'LOW', 10]);
});

test('an older row with no confidence details gives nulls, not undefined', async () => {
  const old = await mkSong('ZZZCKT old');
  await addTranscript(old, { confidence: 'HIGH', notes: null });
  const d = (await curation.getWorkbench(pool, old)).draft_transcript;
  for (const k of ['confidence_score', 'estimated_word_accuracy_pct', 'audio_clarity', 'inaudible_segments', 'confidence_notes']) {
    assert.strictEqual(d[k], null, k);
  }
  assert.equal(d.tier, 'HIGH');
});

test('an UNINTELLIGIBLE transcript does not feed the language suggestions', async () => {
  const s = (await curation.getWorkbench(pool, F)).language_suggestions;
  assert.equal(s.some((x) => x.source === 'transcript'), false);
});
