const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../database/db');
const stories = require('../services/stories');

// Unique fixture sentinel per test file: ZZZSTL. Fixture decades (1880s-1910s) are ones the live catalogue never uses.
const P = 'ZZZSTL';
const GROWL = 'HARSH_SCREAMED_GROWL';
const SHOUT = 'RAW_SHOUTED';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-'));
const write = (slug, text) => fs.writeFileSync(path.join(dir, `${slug}.md`), text);

async function mkAlbum(year) {
  return (await pool.query(
    `INSERT INTO albums (name, release_date, images, data_source) VALUES ($1, $2, '[{"url":"https://example.test/a.jpg"}]'::jsonb, 'manual') RETURNING id`,
    [`${P} Album ${year}`, `${year}-03-01`])).rows[0].id;
}
async function mkSong(title, albumId, vocals, published = true) {
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, album_id) VALUES ($1, 'included', $2, 'manual', $3) RETURNING id`,
    [`${P} ${title}`, published, albumId])).rows[0].id;
  if (vocals) {
    await pool.query(
      `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at, vocal_style)
       VALUES ($1, 'ZZZ-model', 'OK', now(), $2::text[])`, [id, vocals]);
  }
  return id;
}

let ids;
async function seed() {
  if (ids) return ids;
  ids = (async () => {
    const a05 = await mkAlbum(1905);
    for (let i = 0; i < 10; i += 1) await mkSong(`p-${i}`, a05, i < 2 ? [GROWL] : [SHOUT]); // 1900s: growl 20%, shout 80%
    const a15 = await mkAlbum(1915);
    for (let i = 0; i < 12; i += 1) await mkSong(`q-${i}`, a15, i < 9 ? [GROWL] : [SHOUT]); // 1910s: growl 75%, shout 25%
    const a85 = await mkAlbum(1885);
    for (let i = 0; i < 5; i += 1) await mkSong(`thin-${i}`, a85, [GROWL]); // 1880s: only 5 songs, withheld
    const card = await mkSong('card', a15, null);
    const hidden = await mkSong('hidden', a15, null, false);
    return { card, hidden };
  })();
  return ids;
}

after(async () => {
  const sids = (await pool.query(`SELECT id FROM songs WHERE title LIKE $1`, [`${P}%`])).rows.map(r => r.id);
  if (sids.length) {
    await pool.query(`DELETE FROM song_audio_analysis WHERE song_id = ANY($1)`, [sids]);
    await pool.query(`DELETE FROM songs WHERE id = ANY($1)`, [sids]);
  }
  await pool.query(`DELETE FROM albums WHERE name LIKE $1`, [`${P}%`]);
  fs.rmSync(dir, { recursive: true, force: true });
  await pool.end();
});

function fixtureStory({ card, extra = '' }) {
  return `---
title: Test story
subtitle: A subtitle
order: 2
---
@opening songs=${card}
In the 1910s {{pct vocal_style ${GROWL} 1910}} of songs growled, out of {{n vocal_style 1910}}.
@chart decade-bars dimension=vocal_style codes=${GROWL},${SHOUT} decade=1910
@songs
${card} | A card caption.
@chart decade-lines dimension=vocal_style codes=${GROWL},${SHOUT}
@closing browse=vocal_style:${GROWL} label="Explore them"
${extra}`;
}

test('loadStory resolves blocks in order, tokens equal the chart numbers, and decade bars know the previous decade', async () => {
  const { card } = await seed();
  write('fixture', fixtureStory({ card }));
  const story = await stories.loadStory(pool, 'fixture', dir);
  assert.equal(story.title, 'Test story');
  assert.deepEqual(story.blocks.map(b => b.type + (b.variant ? `:${b.variant}` : '')),
    ['opening', 'prose', 'chart:decade-bars', 'songs', 'chart:decade-lines', 'closing']);

  const [opening, prose, bars, songs, lines, closing] = story.blocks;
  assert.equal(opening.title, 'Test story');
  assert.deepEqual(opening.art, ['https://example.test/a.jpg']);

  assert.equal(bars.decade, 1910);
  assert.equal(bars.previousDecade, 1900);
  const growl = bars.bars.find(b => b.code === GROWL);
  assert.equal(growl.share, 0.75);
  assert.equal(growl.previousShare, 0.2);
  assert.equal(growl.label, 'Screamed / Growled');
  assert.equal(bars.n, 12);
  assert.equal(bars.previousN, 10);
  assert.match(bars.caption, /12 sound-analysed songs/);
  assert.match(bars.caption, /more than 100%/);
  assert.match(prose.markdown, new RegExp(`${Math.round(growl.share * 100)}% of songs growled, out of ${bars.n}`));
  assert.ok(!prose.markdown.includes('{{'));

  assert.equal(songs.songs[0].caption, 'A card caption.');
  const d1910 = lines.decades.find(d => d.decade === 1910);
  assert.equal(d1910.plot, true);
  const thin = lines.decades.find(d => d.decade === 1880);
  assert.equal(thin.plot, false);
  const growlLine = lines.series.find(s => s.code === GROWL);
  assert.equal(growlLine.values[lines.decades.indexOf(thin)], null, 'a withheld decade is null, not zero');
  assert.equal(growlLine.values[lines.decades.indexOf(d1910)], 0.75);

  assert.equal(closing.href, `/?vocal_style=${GROWL}`);
  assert.equal(closing.label, 'Explore them');
});

test('a closing block can carry several browse filters', async () => {
  const { card } = await seed();
  write('years', `---\ntitle: Y\n---\n@opening songs=${card}\n@closing browse=year_from:1967,year_to:1999 label="Early years"`);
  const story = await stories.loadStory(pool, 'years', dir);
  assert.equal(story.blocks[1].href, '/?year_from=1967&year_to=1999');
});

test('unknown, traversal-shaped and inherited slugs are NOT_FOUND', async () => {
  await seed();
  for (const slug of ['missing', '../server', '..', 'constructor', '__proto__', '', '%2e%2e', 'fixture/../fixture']) {
    await assert.rejects(() => stories.loadStory(pool, slug, dir), e => e instanceof stories.StoryError && e.code === 'NOT_FOUND', `slug ${JSON.stringify(slug)}`);
  }
});

test('a story naming a song that is not live is SONG_NOT_LIVE', async () => {
  const { hidden } = await seed();
  write('badsong', `---\ntitle: B\n---\n@songs\n${hidden} | nope`);
  await assert.rejects(() => stories.loadStory(pool, 'badsong', dir), e => e.code === 'SONG_NOT_LIVE');
});

test('a token for a withheld decade, an unknown token or an unknown dimension is an error, never raw text', async () => {
  await seed();
  write('thin', `---\ntitle: T\n---\nShare {{pct vocal_style ${GROWL} 1880}}.`);
  await assert.rejects(() => stories.loadStory(pool, 'thin', dir), e => e.code === 'BAD_TOKEN');
  write('unknowntoken', `---\ntitle: T\n---\n{{bogus a b}}`);
  await assert.rejects(() => stories.loadStory(pool, 'unknowntoken', dir), e => e.code === 'BAD_TOKEN');
  write('baddim', `---\ntitle: T\n---\n{{pct tempo_bpm A 1980}}`);
  await assert.rejects(() => stories.loadStory(pool, 'baddim', dir), e => e.code === 'BAD_BLOCK');
});

test('a story with no title or an empty body fails clearly', async () => {
  write('notitle', '---\nsubtitle: x\n---\nbody');
  await assert.rejects(() => stories.loadStory(pool, 'notitle', dir), e => e.code === 'BAD_FORMAT');
  write('empty', '---\ntitle: Empty\n---\n');
  const s = await stories.loadStory(pool, 'empty', dir);
  assert.deepEqual(s.blocks, []);
});

test('an unknown chart variant or a decade-bars decade with too few songs is BAD_BLOCK', async () => {
  await seed();
  write('badchart', `---\ntitle: T\n---\n@chart pie dimension=vocal_style codes=${GROWL}`);
  await assert.rejects(() => stories.loadStory(pool, 'badchart', dir), e => e.code === 'BAD_BLOCK');
  write('thinbars', `---\ntitle: T\n---\n@chart decade-bars dimension=vocal_style codes=${GROWL} decade=1880`);
  await assert.rejects(() => stories.loadStory(pool, 'thinbars', dir), e => e.code === 'BAD_BLOCK');
});

test('listStories returns title, subtitle, order and a cover, sorted by order, and skips a broken story', async () => {
  const { card } = await seed();
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-list-'));
  fs.writeFileSync(path.join(d2, 'b.md'), `---\ntitle: Second\norder: 2\n---\n@opening songs=${card}\nx`);
  fs.writeFileSync(path.join(d2, 'a.md'), `---\ntitle: First\nsubtitle: Sub\norder: 1\n---\n@opening songs=${card}\nx`);
  fs.writeFileSync(path.join(d2, 'broken.md'), 'no front matter');
  const origError = console.error;
  console.error = () => {};
  try {
    const list = await stories.listStories(pool, d2);
    assert.deepEqual(list.map(s => [s.slug, s.title, s.subtitle, s.order]), [['a', 'First', 'Sub', 1], ['b', 'Second', '', 2]]);
    assert.equal(list[0].cover, 'https://example.test/a.jpg');
  } finally {
    console.error = origError;
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

test('every shipped story loads cleanly against the live database', async () => {
  const shipped = path.join(__dirname, '..', 'data', 'stories');
  const files = fs.existsSync(shipped) ? fs.readdirSync(shipped).filter(f => f.endsWith('.md')) : [];
  assert.ok(files.length >= 1, 'at least one story ships');
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    const story = await stories.loadStory(pool, slug, shipped);
    assert.ok(story.title, `${slug} has a title`);
    assert.ok(story.blocks.length > 0, `${slug} has blocks`);
    for (const b of story.blocks) {
      if (b.type === 'prose') assert.ok(!b.markdown.includes('{{'), `${slug}: no unresolved token`);
      if (b.type === 'songs') for (const c of b.songs) assert.ok(c.title, `${slug}: every song card has a title`);
    }
  }
});
