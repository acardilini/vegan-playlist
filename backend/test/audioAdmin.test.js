const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

// Unique fixture sentinel for this file: ZZZAAD.

async function mkSong(title, { status = 'included', published = true } = {}) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0].id;
}

async function addAudio(songId, { samples = [], details = null, status = 'OK', model = 'zzzaad-audio' } = {}) {
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, musical_mood, sonic_intensity, audio_samples, sample_details, sonic_summary)
     VALUES ($1,$2,$3,'2026-11-01 10:00:00',ARRAY['DARK_OMINOUS'],'HEAVY_INTENSE',$4::text[],$5::jsonb,'A heavy track.')`,
    [songId, model, status, samples, details ? JSON.stringify(details) : null]);
}

const SLAUGHTER = [{ type: 'ANIMAL_SLAUGHTER_SFX', timestamp: '0:12', description: 'Stunning bolt', transcript_excerpt: null }];

const queueIds = async (queue) =>
  (await curation.listCurationQueue(pool, { queue })).rows.map((r) => r.id);

test('setAudioSamples round-trips true, false and null, and rejects anything else', async () => {
  const id = await mkSong('ZZZAAD Roundtrip');
  await addAudio(id, { samples: ['ANIMAL_SLAUGHTER_SFX'], details: SLAUGHTER });

  assert.equal((await curation.getWorkbench(pool, id)).audio.show_audio_samples, null, 'starts unreviewed');
  assert.equal((await curation.setAudioSamples(pool, id, { show: true })).audio.show_audio_samples, true);
  assert.equal((await curation.setAudioSamples(pool, id, { show: false })).audio.show_audio_samples, false);
  assert.equal((await curation.setAudioSamples(pool, id, { show: null })).audio.show_audio_samples, null);

  for (const bad of ['yes', 1, 0, 'true', {}, undefined]) {
    await assert.rejects(() => curation.setAudioSamples(pool, id, { show: bad }),
      (e) => e.code === 'BAD_INPUT', `rejects ${JSON.stringify(bad)}`);
  }
  await assert.rejects(() => curation.setAudioSamples(pool, id, {}), (e) => e.code === 'BAD_INPUT', 'a missing value is not "unreview"');
  await assert.rejects(() => curation.setAudioSamples(pool, 999999999, { show: true }), (e) => e.code === 'NOT_FOUND');
  assert.equal((await curation.getWorkbench(pool, id)).audio.show_audio_samples, null, 'a rejected write changed nothing');
});

test('Needs sample approval lists an undecided song with samples; approving or hiding removes it; unreviewing returns it', async () => {
  const id = await mkSong('ZZZAAD Queue');
  await addAudio(id, { samples: ['ANIMAL_SLAUGHTER_SFX'], details: SLAUGHTER });

  assert.ok((await queueIds('needs-sample-approval')).includes(id), 'listed while undecided');
  await curation.setAudioSamples(pool, id, { show: true });
  assert.ok(!(await queueIds('needs-sample-approval')).includes(id), 'approved songs leave');
  await curation.setAudioSamples(pool, id, { show: false });
  assert.ok(!(await queueIds('needs-sample-approval')).includes(id), 'reviewed-and-hidden songs leave');
  await curation.setAudioSamples(pool, id, { show: null });
  assert.ok((await queueIds('needs-sample-approval')).includes(id), 'unreviewing puts it back');

  const counts = await curation.queueCounts(pool);
  assert.equal(typeof counts['needs-sample-approval'], 'number', 'the rail has a count');
  assert.ok(counts['needs-sample-approval'] >= 1);
  assert.ok(curation.QUEUE_NAMES.includes('needs-sample-approval'));
});

test('a song whose only sample is NONE, or with no samples, or a failed audio row, never appears in Needs sample approval', async () => {
  const none = await mkSong('ZZZAAD OnlyNone');
  await addAudio(none, { samples: ['NONE'] });
  const empty = await mkSong('ZZZAAD NoSamples');
  await addAudio(empty, { samples: [] });
  const failed = await mkSong('ZZZAAD Failed');
  await addAudio(failed, { samples: ['ANIMAL_SLAUGHTER_SFX'], status: 'UNAVAILABLE' });
  const noAudio = await mkSong('ZZZAAD NoAudioRow');

  const ids = await queueIds('needs-sample-approval');
  for (const id of [none, empty, failed, noAudio]) assert.ok(!ids.includes(id), `song ${id} is not queued`);
});

test('a pending song with samples is not queued: the queue is for songs that can be seen on the site', async () => {
  const id = await mkSong('ZZZAAD Pending', { status: 'pending', published: false });
  await addAudio(id, { samples: ['ANIMAL_SLAUGHTER_SFX'], details: SLAUGHTER });
  assert.ok(!(await queueIds('needs-sample-approval')).includes(id));
});

test('getWorkbench audio carries the sample details whatever the gate says, and a null block when there is no audio', async () => {
  const id = await mkSong('ZZZAAD Workbench');
  await addAudio(id, { samples: ['ANIMAL_SLAUGHTER_SFX'], details: SLAUGHTER });
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.audio.show_audio_samples, null);
  assert.ok(wb.audio.samples, 'the curator sees the samples before approving them');
  assert.equal(wb.audio.samples.items[0].description, 'Stunning bolt', 'no quote: the description is served');
  const quoted = await mkSong('ZZZAAD Quoted');
  await addAudio(quoted, { samples: ['ADVOCATE_SPEECH_CLIP'], details: [{ type: 'ADVOCATE_SPEECH_CLIP', timestamp: '0:06-0:20', description: 'AI words about a speech', transcript_excerpt: 'A real quote.' }] });
  const q = (await curation.getWorkbench(pool, quoted)).audio.samples.items[0];
  assert.ok(!('description' in q), 'a quote never carries the AI description, even to the curator');
  assert.ok(!JSON.stringify(q).includes('AI words about a speech'));
  assert.equal(wb.audio.status, 'OK');

  const bare = await mkSong('ZZZAAD Workbench bare');
  assert.equal((await curation.getWorkbench(pool, bare)).audio, null);
});

after(async () => {
  await pool.query(`DELETE FROM song_audio_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZAAD%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZAAD%'`);
  await pool.end();
});
