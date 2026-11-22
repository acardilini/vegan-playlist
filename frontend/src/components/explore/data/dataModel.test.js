import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_GROUP_FOR_SENTENCE, MIN_POINT_N, TOP_GENRES,
  yearBounds, filterSongs, computeKpis, genreRanking, median,
  buildEraSeries, buildToneByDecade, buildSonicByDecade, topGenreSentence, insightSentences,
} from './dataModel.js';

const song = (o) => ({ id: 1, t: 't', a: 'a', y: 1990, g: 'punk', ha: false, hl: false, tone: null, bpm: null, lufs: null, ...o });
const many = (n, o) => Array.from({ length: n }, (_, i) => song({ id: i, ...o }));

test('thresholds are the documented constants', () => {
  assert.equal(MIN_GROUP_FOR_SENTENCE, 30);
  assert.equal(MIN_POINT_N, 10);
  assert.equal(TOP_GENRES, 6);
});

test('yearBounds comes from the data and is null when nothing is dated', () => {
  assert.deepEqual(yearBounds([song({ y: 1985 }), song({ y: 2001 }), song({ y: null })]), { min: 1985, max: 2001 });
  assert.equal(yearBounds([song({ y: null })]), null);
  assert.equal(yearBounds([]), null);
});

test('filterSongs: genre, year window, and undated songs drop out only when the window is narrowed', () => {
  const songs = [song({ id: 1, g: 'punk', y: 1990 }), song({ id: 2, g: 'metal', y: 2005 }), song({ id: 3, g: 'punk', y: null })];
  const B = { min: 1990, max: 2005 };
  assert.deepEqual(filterSongs(songs, { pg: '', yf: 1990, yt: 2005 }, B).map(s => s.id), [1, 2, 3]);
  assert.deepEqual(filterSongs(songs, { pg: 'punk', yf: 1990, yt: 2005 }, B).map(s => s.id), [1, 3]);
  assert.deepEqual(filterSongs(songs, { pg: '', yf: 2000, yt: 2005 }, B).map(s => s.id), [2]);
});

test('computeKpis counts songs, songs with a genre, with sound analysis and with lyric coding', () => {
  const k = computeKpis([song({ g: 'punk', ha: true }), song({ g: null, hl: true }), song({ g: 'metal', ha: true, hl: true })]);
  assert.deepEqual(k, { songs: 3, withGenre: 2, audio: 2, lyric: 2 });
});

test('genreRanking is by count, then name', () => {
  const r = genreRanking([song({ g: 'b' }), song({ g: 'a' }), song({ g: 'b' }), song({ g: null })]);
  assert.deepEqual(r, [{ g: 'b', n: 2 }, { g: 'a', n: 1 }]);
});

test('median handles odd, even and empty', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('era series: 5-year buckets aligned to multiples of five, labelled, with empty eras kept', () => {
  const songs = [song({ y: 1987, g: 'punk' }), song({ y: 1992, g: 'punk' })];
  const e = buildEraSeries(songs, { bucket: '5y', mode: 'count', order: ['punk'] });
  assert.deepEqual(e.eras.map(x => x.start), [1985, 1990]);
  assert.equal(e.eras[0].label, '1985–89');
  assert.deepEqual(e.series.find(s => s.key === 'punk').values, [1, 1]);
});

test('era series: 1-year buckets', () => {
  const e = buildEraSeries([song({ y: 1990 }), song({ y: 1992 })], { bucket: '1y', mode: 'count', order: ['punk'] });
  assert.deepEqual(e.eras.map(x => x.label), ['1990', '1991', '1992']);
  assert.deepEqual(e.series[0].values, [1, 0, 1]);
});

test('era series: only the top genres get a series, the rest fold into grey Other, colour follows the fixed order', () => {
  const order = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'];
  const songs = order.map((g, i) => song({ id: i, g, y: 2000 }));
  const e = buildEraSeries(songs, { bucket: '5y', mode: 'count', order });
  assert.deepEqual(e.series.map(s => s.key), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'other']);
  assert.equal(e.series.find(s => s.key === 'other').values[0], 1);
  assert.equal(e.series.find(s => s.key === 'other').colourIndex, null);
  assert.equal(e.series.find(s => s.key === 'g3').colourIndex, 2);
  // filtering down to g4 alone must not repaint it
  const only = buildEraSeries([song({ g: 'g4', y: 2000 })], { bucket: '5y', mode: 'count', order });
  assert.equal(only.series.find(s => s.key === 'g4').colourIndex, 3);
});

test('era series: share mode divides by the era total, songs without a year or genre are skipped', () => {
  const songs = [song({ y: 1990, g: 'punk' }), song({ y: 1990, g: 'metal' }), song({ y: 1990, g: null }), song({ y: null, g: 'punk' })];
  const e = buildEraSeries(songs, { bucket: '5y', mode: 'share', order: ['punk', 'metal'] });
  assert.equal(e.eras[0].total, 2);
  assert.equal(e.series.find(s => s.key === 'punk').values[0], 0.5);
  assert.equal(e.series.find(s => s.key === 'metal').values[0], 0.5);
});

test('tone by decade: only lyric-coded songs with a tone and a year; thin decades are not plotted', () => {
  const songs = [
    ...many(10, { y: 1995, hl: true, tone: 'INDICTMENT' }),
    ...many(10, { y: 1995, hl: true, tone: 'MOBILIZING' }),
    ...many(9, { y: 2005, hl: true, tone: 'INDICTMENT' }),
    song({ y: 1995, hl: true, tone: null }),
    song({ y: 1995, hl: false, tone: 'INDICTMENT' }),
  ];
  const t = buildToneByDecade(songs, { minN: MIN_POINT_N, order: ['INDICTMENT', 'MOBILIZING'] });
  assert.deepEqual(t.decades.map(d => [d.decade, d.n, d.plot]), [[1990, 20, true], [2000, 9, false]]);
  assert.equal(t.series.find(s => s.key === 'INDICTMENT').values[0], 0.5);
  assert.equal(t.series.find(s => s.key === 'INDICTMENT').values[1], null);
  assert.equal(t.n, 29);
});

test('sonic shift: medians per decade ignore nulls and thin decades are withheld', () => {
  const songs = [
    ...many(10, { y: 1991, ha: true, bpm: 100, lufs: -8 }),
    ...many(10, { y: 1992, ha: true, bpm: 140, lufs: -6 }),
    ...many(3, { y: 2003, ha: true, bpm: 90, lufs: -9 }),
    song({ y: 1993, ha: true, bpm: null, lufs: -7 }),
  ];
  const s = buildSonicByDecade(songs, { minN: MIN_POINT_N });
  assert.deepEqual(s.map(d => d.decade), [1990, 2000]);
  assert.equal(s[0].bpm, 120);
  assert.equal(s[0].bpmN, 20);
  assert.equal(s[0].lufsN, 21);
  assert.equal(s[1].bpm, null);
  assert.equal(s[1].lufs, null);
});

test('a decade sentence needs at least 30 songs with a genre and hedges with "about"', () => {
  const labels = { punk: 'Punk', metal: 'Metal' };
  const few = many(29, { y: 1985, g: 'punk' });
  assert.equal(topGenreSentence(few, 1980, labels), null);
  const enough = [...many(20, { y: 1985, g: 'punk' }), ...many(10, { y: 1986, g: 'metal' })];
  const s = topGenreSentence(enough, 1980, labels);
  assert.match(s, /1980s/);
  assert.match(s, /Punk/);
  assert.match(s, /about 67%/);
  assert.doesNotMatch(s, /inferred|audio/i);
});

test('insightSentences returns at most the earliest and latest qualifying decades', () => {
  const labels = { punk: 'Punk', metal: 'Metal', rock: 'Rock' };
  const songs = [...many(30, { y: 1985, g: 'punk' }), ...many(30, { y: 1995, g: 'rock' }), ...many(30, { y: 2005, g: 'metal' }), ...many(5, { y: 2015, g: 'metal' })];
  const lines = insightSentences(songs, labels);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /1980s/);
  assert.match(lines[1], /2000s/);
  assert.deepEqual(insightSentences(many(5, { y: 1985 }), labels), []);
});
