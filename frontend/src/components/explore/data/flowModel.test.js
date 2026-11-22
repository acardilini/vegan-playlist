import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_GROUP_FOR_SENTENCE } from './dataModel.js';
import {
  TOP_NODES, MIN_PAIR_N, TOP_PAIRS, TOP_PATHS, PRESETS,
  buildFlow, strongestSentence, topPathways, flowTable, topThemePairs, pairsTable,
} from './flowModel.js';

const PRESET = PRESETS[0]; // genre-tone-action: fields g, tone, act
const labels = {
  genres: { metal: 'Metal', punk: 'Punk', folk: 'Folk' },
  tone: { angry: 'Angry', hopeful: 'Hopeful', sad: 'Sad' },
  act: { protest: 'Protest', educate: 'Educate' },
  thm: { rights: 'Rights', health: 'Health', planet: 'Planet', labour: 'Labour' },
};

const song = (o) => ({ id: 1, g: 'punk', tone: 'angry', act: 'protest', thm: [], ...o });
const many = (n, o) => Array.from({ length: n }, (_, i) => song({ id: i, ...o }));

test('thresholds are the documented constants', () => {
  assert.equal(TOP_NODES, 6);
  assert.equal(MIN_PAIR_N, 3);
  assert.equal(TOP_PAIRS, 10);
  assert.equal(TOP_PATHS, 10);
  assert.equal(MIN_GROUP_FOR_SENTENCE, 30);
});

test('PRESET ids are exactly the three in the spec, in order', () => {
  assert.deepEqual(PRESETS.map(p => p.id), ['genre-tone-action', 'audience-frame-action', 'voice-tone-emotion']);
  assert.deepEqual(PRESETS.map(p => p.label), ['Genre, tone, action', 'Audience, frame, action', 'Voice, tone, emotion']);
  assert.deepEqual(PRESETS[0].columns, [
    { field: 'g', name: 'Genre', labelKey: 'genres' },
    { field: 'tone', name: 'Lyrical tone', labelKey: 'tone' },
    { field: 'act', name: 'Advocacy action', labelKey: 'act' },
  ]);
  assert.deepEqual(PRESETS[0].browseKeys, ['parent_genres', 'lyrical_tone', 'actions']);
  assert.deepEqual(PRESETS[1].columns.map(c => [c.field, c.name, c.labelKey]),
    [['aud', 'Speaking to', 'aud'], ['frm', 'Moral frame', 'frm'], ['act', 'Advocacy action', 'act']]);
  assert.deepEqual(PRESETS[1].browseKeys, ['target_audience', 'moral_frames', 'actions']);
  assert.deepEqual(PRESETS[2].columns.map(c => [c.field, c.name, c.labelKey]),
    [['avoc', 'Vocal style', 'avoc'], ['tone', 'Lyrical tone', 'tone'], ['emo', 'Emotion', 'emo']]);
  assert.deepEqual(PRESETS[2].browseKeys, ['vocal_style', 'lyrical_tone', 'emotions']);
});

test('buildFlow counts only songs with all three columns', () => {
  const songs = [
    song({ id: 1 }),
    song({ id: 2, g: 'metal', tone: 'sad' }),
    song({ id: 3, g: 'folk', act: 'educate' }),
    song({ id: 4, g: null }),
    song({ id: 5, act: null }),
  ];
  const flow = buildFlow(songs, PRESET, { labels });
  assert.equal(flow.n, 3);
  assert.equal(flow.columns.length, 3);
  for (const col of flow.columns) assert.equal(col.nodes.reduce((s, x) => s + x.n, 0), 3);
  for (const link of flow.links) assert.equal(link.reduce((s, x) => s + x.n, 0), 3);
  assert.equal(flow.paths.reduce((s, p) => s + p.n, 0), 3);
  assert.equal(flow.preset, PRESET);
  assert.deepEqual(flow.columns.map(c => c.name), ['Genre', 'Lyrical tone', 'Advocacy action']);
});

test('buildFlow folds codes beyond the top six into one Other node', () => {
  const tones = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  const counts = [9, 8, 7, 6, 5, 4, 3, 2];
  const songs = [];
  tones.forEach((t, i) => songs.push(...many(counts[i], { tone: t, id: songs.length + i * 100 })));
  const flow = buildFlow(songs, PRESET, { labels });
  const nodes = flow.columns[1].nodes;
  assert.equal(nodes.length, TOP_NODES + 1);
  const last = nodes[nodes.length - 1];
  assert.equal(last.other, true);
  assert.equal(last.key, 'other');
  assert.equal(last.label, 'Other');
  assert.equal(last.slot, null);
  assert.equal(last.n, 3 + 2);
  assert.deepEqual(nodes.slice(0, 6).map(x => x.key), ['t1', 't2', 't3', 't4', 't5', 't6']);
  // links fold the same way: nothing refers to a folded code
  const keys = new Set(nodes.map(x => x.key));
  for (const l of flow.links[0]) assert.ok(keys.has(l.to));
  for (const l of flow.links[1]) assert.ok(keys.has(l.from));
});

test('buildFlow creates no Other node when a column has six or fewer codes', () => {
  const songs = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((t, i) => many(2, { tone: t, id: i * 10 }));
  const flow = buildFlow(songs, PRESET, { labels });
  assert.equal(flow.columns[1].nodes.length, 6);
  assert.ok(flow.columns.every(c => c.nodes.every(x => !x.other)));
});

test('buildFlow orders ties by label and is deterministic', () => {
  const songs = [
    song({ id: 1, tone: 'sad' }), song({ id: 2, tone: 'hopeful' }), song({ id: 3, tone: 'angry' }),
  ];
  const a = buildFlow(songs, PRESET, { labels });
  assert.deepEqual(a.columns[1].nodes.map(x => x.label), ['Angry', 'Hopeful', 'Sad']);
  const b = buildFlow([...songs].reverse(), PRESET, { labels });
  assert.deepEqual(b, a);
  assert.deepEqual(buildFlow(songs, PRESET, { labels }), a);
});

test('buildFlow slots follow firstOrder', () => {
  const songs = [
    ...many(5, { g: 'punk', id: 100 }),
    ...many(4, { g: 'metal', id: 200 }),
    ...many(3, { g: 'folk', id: 300 }),
  ];
  const flow = buildFlow(songs, PRESET, { labels, firstOrder: ['x', 'y', 'folk', 'z', 'metal'] });
  const nodes = flow.columns[0].nodes;
  const by = Object.fromEntries(nodes.map(x => [x.key, x.slot]));
  assert.equal(by.folk, 2); // rank 3 in the slice, slot 2 by firstOrder
  assert.equal(by.metal, 4);
  assert.equal(by.punk, 0); // absent from firstOrder: lowest unused slot
  assert.equal(new Set(nodes.map(x => x.slot)).size, nodes.length);
  assert.ok(flow.columns[1].nodes.every(x => x.slot === null));
  assert.ok(flow.columns[2].nodes.every(x => x.slot === null));
});

test('buildFlow slots: a firstOrder index of six or more falls back to the lowest unused slot', () => {
  const songs = [...many(2, { g: 'punk', id: 1 }), ...many(1, { g: 'metal', id: 10 })];
  const flow = buildFlow(songs, PRESET, { labels, firstOrder: ['a', 'b', 'c', 'd', 'e', 'f', 'punk'] });
  const by = Object.fromEntries(flow.columns[0].nodes.map(x => [x.key, x.slot]));
  assert.deepEqual([by.punk, by.metal].sort(), [0, 1]);
});

test('buildFlow with a single genre has one column-0 node', () => {
  const flow = buildFlow(many(4, { g: 'metal' }), PRESET, { labels });
  assert.equal(flow.columns[0].nodes.length, 1);
  assert.equal(flow.columns[0].nodes[0].n, flow.n);
});

test('buildFlow with no eligible songs returns n 0 and empty columns, links and paths', () => {
  const flow = buildFlow([song({ g: null })], PRESET, { labels });
  assert.equal(flow.n, 0);
  assert.deepEqual(flow.columns, []);
  assert.deepEqual(flow.links, []);
  assert.deepEqual(flow.paths, []);
  assert.equal(strongestSentence(flow), null);
});

test('buildFlow falls back to a title-cased code when the label is missing', () => {
  const flow = buildFlow(many(2, { act: 'animal_rights' }), PRESET, { labels });
  assert.equal(flow.columns[2].nodes[0].label, 'Animal Rights');
  assert.equal(buildFlow(many(2, { act: 'animal_rights' }), PRESET).columns[0].nodes[0].label, 'Punk');
});

test('buildFlow keeps a real "other" genre distinct from the folded Other node', () => {
  const songs = [
    ...many(9, { g: 'other', id: 1 }),
    ...['a', 'b', 'c', 'd', 'e', 'f'].flatMap((g, i) => many(i + 1, { g, id: 100 + i * 20 })),
  ];
  const flow = buildFlow(songs, PRESET, { labels });
  const nodes = flow.columns[0].nodes;
  assert.equal(new Set(nodes.map(x => x.key)).size, nodes.length);
  assert.equal(nodes.filter(x => x.other).length, 1);
  assert.ok(nodes.some(x => !x.other && x.key === 'other'));
});

// 40 songs: punk->angry->protest x25, metal->sad->educate x10, folk->hopeful->protest x5
const sentenceSongs = () => [
  ...many(25, { g: 'punk', tone: 'angry', act: 'protest', id: 1000 }),
  ...many(10, { g: 'metal', tone: 'sad', act: 'educate', id: 2000 }),
  ...many(5, { g: 'folk', tone: 'hopeful', act: 'protest', id: 3000 }),
];

test('strongestSentence is null below 30 songs and names the top non-Other link at 30+', () => {
  const small = buildFlow(many(MIN_GROUP_FOR_SENTENCE - 1), PRESET, { labels });
  assert.equal(strongestSentence(small), null);

  const songs = sentenceSongs();
  const flow = buildFlow(songs, PRESET, { labels });
  const top = songs.filter(s => s.g === 'punk' && s.tone === 'angry').length;
  const pct = Math.round((top / songs.length) * 100);
  const text = strongestSentence(flow);
  assert.equal(text, `Strongest link, Genre to Lyrical tone: Punk to Angry, ${top} songs (about ${pct}% of the pathway songs).`);
  assert.ok(text.includes('Punk') && text.includes('Angry') && text.includes(String(top)) && text.includes(`${pct}%`));
});

test('strongestSentence skips a larger link that touches Other', () => {
  // 8 tones: the big folded Other cannot be named; sentence must come from named nodes only
  const tones = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  const counts = [6, 6, 6, 6, 6, 6, 1, 1];
  const songs = [];
  tones.forEach((t, i) => songs.push(...many(counts[i], { tone: t, id: i * 100 })));
  const flow = buildFlow(songs, PRESET, { labels });
  assert.equal(flow.n, 38);
  const text = strongestSentence(flow);
  assert.ok(text && !text.includes('Other'));
});

test('topPathways never includes Other', () => {
  const tones = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  const songs = [];
  tones.forEach((t, i) => songs.push(...many(9 - i, { tone: t, id: i * 100 })));
  const flow = buildFlow(songs, PRESET, { labels });
  assert.ok(flow.paths.some(p => p.keys.includes('other')));
  const top = topPathways(flow);
  assert.ok(top.length > 0);
  assert.ok(top.every(p => !p.keys.includes('other') && !p.labels.includes('Other')));
  assert.equal(topPathways(flow, 2).length, 2);
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].n >= top[i].n);
});

test('flowTable has one row per link', () => {
  const flow = buildFlow(sentenceSongs(), PRESET, { labels });
  const table = flowTable(flow);
  assert.deepEqual(table.head, ['Columns', 'From', 'To', 'Songs']);
  assert.equal(table.rows.length, flow.links[0].length + flow.links[1].length);
  assert.deepEqual(table.rows[0], ['Genre to Lyrical tone', 'Punk', 'Angry', 25]);
  assert.ok(table.rows.some(r => r[0] === 'Lyrical tone to Advocacy action'));
});

test('topThemePairs counts a pair once per song, drops pairs below minN, and orders by count then label', () => {
  const songs = [
    ...many(4, { thm: ['rights', 'health'], id: 100 }),
    ...many(3, { thm: ['planet', 'health'], id: 200 }),
    ...many(3, { thm: ['labour', 'planet'], id: 300 }),
    song({ id: 400, thm: ['rights', 'rights'] }), // a repeated code never pairs with itself
    song({ id: 401, thm: ['rights', 'planet'] }), // below minN
    song({ id: 402, thm: [] }),
  ];
  const res = topThemePairs(songs, { labels });
  assert.equal(res.n, 12);
  assert.deepEqual(res.pairs.map(p => [p.a, p.b, p.n]), [
    ['health', 'rights', 4],
    ['health', 'planet', 3],
    ['labour', 'planet', 3],
  ]);
  assert.equal(res.pairs[0].aLabel, 'Health');
  assert.equal(res.pairs[0].bLabel, 'Rights');
  assert.equal(res.pairs[0].share, 4 / 12);
  assert.ok(res.pairs.every(p => p.a !== p.b && p.a < p.b));
  assert.equal(topThemePairs(songs, { labels, limit: 1 }).pairs.length, 1);
});

test('topThemePairs returns an empty pairs list when no pair reaches minN', () => {
  const songs = [song({ thm: ['rights', 'health'] }), song({ thm: ['planet'] })];
  const res = topThemePairs(songs, { labels });
  assert.equal(res.n, 2);
  assert.deepEqual(res.pairs, []);
  assert.deepEqual(topThemePairs([], { labels }), { n: 0, pairs: [] });
});

test('pairsTable renders whole-percent shares', () => {
  const songs = many(4, { thm: ['rights', 'health'] });
  const table = pairsTable(topThemePairs(songs, { labels }));
  assert.deepEqual(table.head, ['Theme', 'With', 'Songs', 'Share']);
  assert.deepEqual(table.rows, [['Health', 'Rights', 4, '100%']]);
  assert.equal(MIN_PAIR_N, 3);
});
