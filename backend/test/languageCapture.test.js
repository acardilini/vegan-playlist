const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

// Unique fixture sentinel for this file: ZZZLNC. Fixture songs are never published, so no public read can see them;
// deleting a song cascades its transcript row.

const SECRET = 'ZZZLNC the draft words that must never leave the admin API';

async function mkSong(title, { language = null, status = 'included' } = {}) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, language, data_source) VALUES ($1,$2,false,$3,'manual') RETURNING id`,
    [title, status, language])).rows[0].id;
}
async function addAnalysis(songId, { langs = ['English'], conf = 'HIGH', model = 'zzzlnc-model', at = '2026-11-01 10:00:00' } = {}) {
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, perspective, themes, topics, advocacy, tactics, moral_frames,
       detected_languages, language_confidence, analyzed_at)
     VALUES ($1,$2,'CRITIC_PHILOSOPHER','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$3::text[],$4,$5)`,
    [songId, model, langs, conf, at]);
}
async function addTranscript(songId, { status = 'OK', langs = ['English'], conf = 'MEDIUM', text = SECRET, words = 245 } = {}) {
  await pool.query(
    `INSERT INTO song_audio_transcripts (song_id, model_used, youtube_id_used, status, transcript, detected_languages,
       word_count, confidence, transcribed_at)
     VALUES ($1,'zzzlnc-hydrogen','abc123DEF45',$2,$3,$4::text[],$5,$6,'2026-11-02 10:00:00')`,
    [songId, status, text, langs, words, conf]);
}
const addLyrics = (songId, lyrics, junk = null) =>
  pool.query(`INSERT INTO song_lyrics (song_id, lyrics, junk_kind) VALUES ($1,$2,$3)`, [songId, lyrics, junk]);
const queueRows = async (queue) => (await curation.listCurationQueue(pool, { queue })).rows;
const queueIds = async (queue) => (await queueRows(queue)).map((r) => r.id);
const dbLang = async (id) => (await pool.query('SELECT language FROM songs WHERE id=$1', [id])).rows[0].language;

after(async () => {
  await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZLNC%')`);
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZLNC%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZLNC%'`);
  await pool.end();
});

// ---- Language suggestions ----

test('getWorkbench lists the detected-language suggestions: lyric analysis first, then the audio transcript', async () => {
  const id = await mkSong('ZZZLNC both');
  await addAnalysis(id, { langs: ['Māori', 'English'], conf: 'HIGH' });
  await addTranscript(id, { langs: ['English'], conf: 'LOW' });
  const wb = await curation.getWorkbench(pool, id);
  assert.deepEqual(wb.language_suggestions, [
    { source: 'analysis', languages: ['Māori', 'English'], confidence: 'HIGH', model_used: 'zzzlnc-model', differs: false },
    { source: 'transcript', languages: ['English'], confidence: 'LOW', model_used: 'zzzlnc-hydrogen', differs: false },
  ]);
});

test('suggestions ignore rows without languages, non-OK transcripts, and use the newest analysis row that has languages', async () => {
  const none = await mkSong('ZZZLNC none');
  await addAnalysis(none, { langs: null, conf: null });
  await addTranscript(none, { status: 'ERROR', langs: ['French'] });
  assert.deepEqual((await curation.getWorkbench(pool, none)).language_suggestions, []);

  const twice = await mkSong('ZZZLNC twice');
  await addAnalysis(twice, { langs: ['German'], model: 'zzzlnc-old', at: '2026-10-01 10:00:00' });
  await addAnalysis(twice, { langs: ['Spanish'], model: 'zzzlnc-new', at: '2026-11-05 10:00:00' });
  const s = (await curation.getWorkbench(pool, twice)).language_suggestions;
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].languages, ['Spanish']);
});

test('differs is true only when a manual language is set and the detected set is different (case and order ignored)', async () => {
  const same = await mkSong('ZZZLNC same', { language: ['english', 'Māori'] });
  await addAnalysis(same, { langs: ['Māori', 'English'] });
  assert.equal((await curation.getWorkbench(pool, same)).language_suggestions[0].differs, false);

  const diff = await mkSong('ZZZLNC diff', { language: ['Māori'] });
  await addAnalysis(diff, { langs: ['Māori', 'English'] });
  assert.equal((await curation.getWorkbench(pool, diff)).language_suggestions[0].differs, true);

  const unset = await mkSong('ZZZLNC unset');
  await addAnalysis(unset, { langs: ['English'] });
  assert.equal((await curation.getWorkbench(pool, unset)).language_suggestions[0].differs, false, 'nothing to differ from');
});

test('chooseLanguage copies the detected languages of the named source; the client never supplies them', async () => {
  const id = await mkSong('ZZZLNC choose');
  await addAnalysis(id, { langs: ['Spanish', 'English'] });
  await addTranscript(id, { langs: ['French'] });
  const wb = await curation.chooseLanguage(pool, id, { source: 'analysis', languages: ['Klingon'] });
  assert.deepEqual(await dbLang(id), ['Spanish', 'English']);
  assert.deepEqual(wb.language, ['Spanish', 'English'], 'returns the reassembled workbench');
  await curation.chooseLanguage(pool, id, { source: 'transcript' });
  assert.deepEqual(await dbLang(id), ['French'], 'a choice replaces what was there');
});

test('chooseLanguage refuses a missing source, an unknown source, a source with no data, and a missing song', async () => {
  const id = await mkSong('ZZZLNC refuse');
  await addAnalysis(id, { langs: ['English'] });
  await assert.rejects(curation.chooseLanguage(pool, id, {}), { code: 'BAD_INPUT' });
  await assert.rejects(curation.chooseLanguage(pool, id, { source: 'nonsense' }), { code: 'BAD_INPUT' });
  await assert.rejects(curation.chooseLanguage(pool, id, { source: 'transcript' }), { code: 'BAD_INPUT' });
  await assert.rejects(curation.chooseLanguage(pool, 999999999, { source: 'analysis' }), { code: 'NOT_FOUND' });
  assert.equal(await dbLang(id), null, 'nothing was written');
});

test('language-suggested rail: included, no language yet, a suggestion exists; rows carry the suggestion', async () => {
  const fill = await mkSong('ZZZLNC rail fill');
  await addTranscript(fill, { langs: ['Hebrew', 'English'] });
  const hasLang = await mkSong('ZZZLNC rail has', { language: ['English'] });
  await addAnalysis(hasLang);
  const noSuggestion = await mkSong('ZZZLNC rail nosug');
  const pending = await mkSong('ZZZLNC rail pending', { status: 'pending' });
  await addAnalysis(pending);

  assert.ok(curation.QUEUE_NAMES.includes('language-suggested'));
  const rows = await queueRows('language-suggested');
  const r = rows.find((x) => x.id === fill);
  assert.deepEqual(r.language_suggestion, ['Hebrew', 'English']);
  for (const id of [hasLang, noSuggestion, pending]) assert.ok(!rows.some((x) => x.id === id), `song ${id} is not listed`);
  assert.ok((await queueIds('needs-language')).includes(fill), 'Needs language is unchanged: it still lists the song');

  await curation.chooseLanguage(pool, fill, { source: 'transcript' });
  assert.ok(!(await queueIds('language-suggested')).includes(fill), 'leaves once a language is set');
  assert.equal(typeof (await curation.queueCounts(pool))['language-suggested'], 'number');
});

// ---- Draft transcripts ----

test('getWorkbench carries the draft transcript only while the song has no real lyrics', async () => {
  const id = await mkSong('ZZZLNC draft');
  await addTranscript(id, { langs: ['English', 'Hebrew'], conf: 'HIGH', words: 321 });
  const d = (await curation.getWorkbench(pool, id)).draft_transcript;
  assert.deepEqual(
    { ...d, transcribed_at: undefined },
    { model_used: 'zzzlnc-hydrogen', youtube_id: 'abc123DEF45', transcript: SECRET, languages: ['English', 'Hebrew'],
      word_count: 321, confidence: 'HIGH', transcribed_at: undefined });

  await addLyrics(id, 'Real words\nof a real song');
  assert.equal((await curation.getWorkbench(pool, id)).draft_transcript, null, 'real lyrics retire the draft');

  const junk = await mkSong('ZZZLNC draft junk');
  await addTranscript(junk);
  await addLyrics(junk, 'NA', 'placeholder');
  assert.ok((await curation.getWorkbench(pool, junk)).draft_transcript, 'junk-flagged lyrics are not real lyrics');

  const failed = await mkSong('ZZZLNC draft failed');
  await addTranscript(failed, { status: 'ERROR' });
  assert.equal((await curation.getWorkbench(pool, failed)).draft_transcript, null, 'only OK transcripts are offered');

  const empty = await mkSong('ZZZLNC draft empty');
  await addTranscript(empty, { text: '   ' });
  assert.equal((await curation.getWorkbench(pool, empty)).draft_transcript, null, 'a blank transcript is not a draft');
});

test('check-transcripts rail: included, a draft transcript, no real lyrics; rows never carry the transcript text', async () => {
  const draft = await mkSong('ZZZLNC ck draft');
  await addTranscript(draft);
  const withLyrics = await mkSong('ZZZLNC ck lyrics');
  await addTranscript(withLyrics);
  await addLyrics(withLyrics, 'Real words\nof a real song');
  const noTranscript = await mkSong('ZZZLNC ck none');
  const pending = await mkSong('ZZZLNC ck pending', { status: 'pending' });
  await addTranscript(pending);

  assert.ok(curation.QUEUE_NAMES.includes('check-transcripts'));
  const rows = await queueRows('check-transcripts');
  assert.ok(rows.some((r) => r.id === draft));
  for (const id of [withLyrics, noTranscript, pending]) assert.ok(!rows.some((r) => r.id === id), `song ${id} is not listed`);
  assert.ok(!JSON.stringify(rows).includes('ZZZLNC the draft words'), 'queue rows carry no transcript text');
  assert.ok((await queueIds('needs-lyrics')).includes(draft), 'Needs lyrics still lists it');

  // Saving the (curator-checked) text through saveLyrics is the one way it becomes lyrics, and it leaves the rail.
  await curation.saveLyrics(pool, draft, { lyrics: 'Checked words\nof the speech', lyrics_source: 'AI transcript, curator-checked' });
  assert.ok(!(await queueIds('check-transcripts')).includes(draft));
  assert.equal(typeof (await curation.queueCounts(pool))['check-transcripts'], 'number');
});

test('the web app never writes promoted_to_lyrics (it stays the analysis project\'s column)', async () => {
  const id = await mkSong('ZZZLNC promoted');
  await addTranscript(id);
  await curation.saveLyrics(pool, id, { lyrics: 'Checked words', lyrics_source: 'AI transcript, curator-checked' });
  const r = (await pool.query('SELECT promoted_to_lyrics FROM song_audio_transcripts WHERE song_id=$1', [id])).rows[0];
  assert.equal(r.promoted_to_lyrics, false);
});
