const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const stories = require('../services/stories');

// Unique fixture sentinel per test file: ZZZSTD. Fixtures sit in decades nobody else occupies (1920s-1940s) so the
// live catalogue cannot change the counts.
const P = 'ZZZSTD';
const ART = 'https://example.test/art.jpg';

async function mkAlbum(year, name = `${P} Album ${year}`) {
  return (await pool.query(
    `INSERT INTO albums (name, release_date, images, data_source) VALUES ($1, $2, $3::jsonb, 'manual') RETURNING id`,
    [name, `${year}-06-01`, JSON.stringify([{ url: ART }])])).rows[0].id;
}
async function mkSong(title, albumId, { published = true } = {}) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, album_id) VALUES ($1, 'included', $2, 'manual', $3) RETURNING id`,
    [`${P} ${title}`, published, albumId])).rows[0].id;
}
async function mkAudio(songId, vocals) {
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, vocal_style)
     VALUES ($1, 'ZZZ-model', 'OK', now(), $2::text[])`, [songId, vocals]);
}
async function mkLyric(songId, tone) {
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, analyzed_at, lyrical_tone, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'ZZZ-model', now(), $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [songId, tone]);
}

const GROWL = 'HARSH_SCREAMED_GROWL';
const SHOUT = 'RAW_SHOUTED';
let ready;
async function seed() {
  if (ready) return ready;
  ready = (async () => {
    const a30 = await mkAlbum(1935);
    for (let i = 0; i < 12; i += 1) {
      const id = await mkSong(`g30-${i}`, a30);
      await mkAudio(id, i < 6 ? [GROWL] : i < 9 ? [SHOUT, GROWL] : [SHOUT]);
    }
    await mkAudio(await mkSong('g30-hidden', a30, { published: false }), [GROWL]);
    const a20 = await mkAlbum(1925);
    for (let i = 0; i < 9; i += 1) await mkAudio(await mkSong(`g20-${i}`, a20), [GROWL]);
    const a40 = await mkAlbum(1945);
    for (let i = 0; i < 10; i += 1) await mkLyric(await mkSong(`t40-${i}`, a40), i < 6 ? 'INDICTMENT' : 'RESISTANCE');
    await mkLyric(await mkSong('t40-err', a40), 'ERROR');
    const artistId = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1, 'manual') RETURNING id`, [`${P} Band`])).rows[0].id;
    const card = await mkSong('card', await mkAlbum(1955));
    await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2)`, [card, artistId]);
    const card2 = await mkSong('card2', a30);
    const hidden = await mkSong('card-hidden', a30, { published: false });
    return { card, card2, hidden };
  })();
  return ready;
}

after(async () => {
  const ids = (await pool.query(`SELECT id FROM songs WHERE title LIKE $1`, [`${P}%`])).rows.map(r => r.id);
  if (ids.length) {
    await pool.query(`DELETE FROM song_audio_analysis WHERE song_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM song_artists WHERE song_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM songs WHERE id = ANY($1)`, [ids]);
  }
  await pool.query(`DELETE FROM artists WHERE name LIKE $1`, [`${P}%`]);
  await pool.query(`DELETE FROM albums WHERE name LIKE $1`, [`${P}%`]);
  await pool.end();
});

const decadeOf = (res, d) => res.decades.find(x => x.decade === d);

test('decadeShares: vocal style share per decade over sound-analysed live songs, multi-value shares may overlap', async () => {
  await seed();
  const res = await stories.decadeShares(pool, 'vocal_style');
  const d = decadeOf(res, 1930);
  assert.equal(d.n, 12, 'the unpublished song is not counted');
  assert.equal(d.plot, true);
  assert.equal(d.shares[GROWL], 9 / 12);
  assert.equal(d.shares[SHOUT], 6 / 12);
  assert.ok(d.shares[GROWL] + d.shares[SHOUT] > 1, 'multi-value shares add to more than 100%');
  assert.equal(res.labels[GROWL], 'Screamed / Growled');
});

test('decadeShares: a decade with fewer than 10 songs is withheld', async () => {
  await seed();
  const res = await stories.decadeShares(pool, 'vocal_style');
  const d = decadeOf(res, 1920);
  assert.equal(d.n, 9);
  assert.equal(d.plot, false);
  assert.throws(() => stories.pct(res, GROWL, 1920), e => e instanceof stories.StoryError && e.code === 'BAD_TOKEN');
});

test('pct and nOf format a decade figure and refuse unknown decades or codes', async () => {
  await seed();
  const res = await stories.decadeShares(pool, 'vocal_style');
  assert.equal(stories.pct(res, GROWL, 1930), '75%');
  assert.equal(stories.nOf(res, 1930), '12');
  assert.throws(() => stories.pct(res, GROWL, 1800), e => e.code === 'BAD_TOKEN');
  assert.throws(() => stories.pct(res, 'NOT_A_CODE', 1930), e => e.code === 'BAD_TOKEN');
});

test('decadeShares: a lyric scalar counts only coded values, against all visibly analysed songs in the decade', async () => {
  await seed();
  const res = await stories.decadeShares(pool, 'lyrical_tone');
  const d = decadeOf(res, 1940);
  assert.equal(d.n, 11);
  assert.equal(d.shares.INDICTMENT, 6 / 11);
  assert.equal(d.shares.RESISTANCE, 4 / 11);
  assert.equal(d.shares.ERROR, undefined, 'an off-codebook code never appears');
});

test('an unknown dimension is BAD_BLOCK', async () => {
  await assert.rejects(() => stories.decadeShares(pool, 'tempo_bpm; DROP TABLE songs'), e => e.code === 'BAD_BLOCK');
});

test('songCards returns art, artists and year in the order given and refuses songs that are not live', async () => {
  const { card, card2, hidden } = await seed();
  const cards = await stories.songCards(pool, [{ id: card2, caption: 'second' }, { id: card, caption: 'first' }]);
  assert.deepEqual(cards.map(c => c.id), [card2, card]);
  assert.equal(cards[1].artists, `${P} Band`);
  assert.equal(cards[1].year, 1955);
  assert.equal(cards[1].art, ART);
  assert.equal(cards[1].caption, 'first');
  assert.deepEqual(Object.keys(cards[0]).sort(), ['art', 'artists', 'caption', 'id', 'title', 'year']);
  await assert.rejects(() => stories.songCards(pool, [{ id: hidden, caption: '' }]), e => e.code === 'SONG_NOT_LIVE');
  await assert.rejects(() => stories.songCards(pool, [{ id: 999999999, caption: '' }]), e => e.code === 'SONG_NOT_LIVE');
});
