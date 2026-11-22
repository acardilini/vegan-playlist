import test from 'node:test';
import assert from 'node:assert/strict';
import { barRows, decadeLabel, chartTable, linesDomain } from './storyModel.js';

const bars = {
  variant: 'decade-bars', decade: 1990, previousDecade: 1980, n: 104, previousN: 39,
  bars: [
    { code: 'HARSH_SCREAMED_GROWL', label: 'Screamed / Growled', share: 0.4615, previousShare: 0.0256 },
    { code: 'RAW_SHOUTED', label: 'Shouted', share: 0.5, previousShare: 0.7436 },
    { code: 'GANG_CHANT', label: 'Group Chants', share: 0.3365, previousShare: 0.3365 },
  ],
};

test('decadeLabel', () => {
  assert.equal(decadeLabel(1980), '1980s');
});

test('barRows keeps the file order, rounds to whole percent and words a rise, a drop and no change', () => {
  const rows = barRows(bars);
  assert.deepEqual(rows.map(r => r.code), ['HARSH_SCREAMED_GROWL', 'RAW_SHOUTED', 'GANG_CHANT']);
  assert.deepEqual(rows.map(r => [r.pct, r.ghostPct]), [[46, 3], [50, 74], [34, 34]]);
  assert.equal(rows[0].deltaText, '+43 points since the 1980s');
  assert.equal(rows[1].deltaText, '-24 points since the 1980s');
  assert.equal(rows[2].deltaText, 'no change since the 1980s');
});

test('barRows has no ghost and no delta when there is no previous decade', () => {
  const rows = barRows({ ...bars, previousDecade: null, previousN: null, bars: bars.bars.map(b => ({ ...b, previousShare: null })) });
  for (const r of rows) { assert.equal(r.ghostPct, null); assert.equal(r.deltaText, null); }
});

test('chartTable for bars lists this decade and, when present, the previous one', () => {
  const t = chartTable(bars);
  assert.deepEqual(t.head, ['Category', '1990s', '1980s']);
  assert.deepEqual(t.rows[0], ['Screamed / Growled', '46%', '3%']);
  const lone = chartTable({ ...bars, previousDecade: null, bars: bars.bars.map(b => ({ ...b, previousShare: null })) });
  assert.deepEqual(lone.head, ['Category', '1990s']);
  assert.deepEqual(lone.rows[0], ['Screamed / Growled', '46%']);
});

test('chartTable for lines has a row per decade with n and a column per series, "too few" for withheld values', () => {
  const lines = {
    variant: 'decade-lines',
    decades: [{ decade: 1970, n: 6, plot: false }, { decade: 1980, n: 39, plot: true }],
    series: [{ code: 'A', label: 'Growl', values: [null, 0.0256] }, { code: 'B', label: 'Shout', values: [null, 0.7436] }],
  };
  const t = chartTable(lines);
  assert.deepEqual(t.head, ['Decade', 'Songs', 'Growl', 'Shout']);
  assert.deepEqual(t.rows, [['1970s', 6, 'too few', 'too few'], ['1980s', 39, '3%', '74%']]);
});

test('linesDomain rounds the top up to a multiple of 20% and never exceeds 100%', () => {
  const s = (values) => [{ values }];
  assert.deepEqual(linesDomain(s([null, 0.46, 0.12])), [0, 0.6]);
  assert.deepEqual(linesDomain(s([0.05])), [0, 0.2]);
  assert.deepEqual(linesDomain(s([0.99])), [0, 1]);
  assert.deepEqual(linesDomain(s([null, null])), [0, 0.2]);
});

test('colourSlots gives each code one slot in order of first appearance across the story, so a code keeps its colour', async () => {
  const { colourSlots, colourVar } = await import('./storyModel.js');
  const blocks = [
    { type: 'prose', markdown: 'x' },
    { type: 'chart', variant: 'decade-bars', bars: [{ code: 'A' }, { code: 'B' }] },
    { type: 'chart', variant: 'decade-bars', bars: [{ code: 'B' }, { code: 'C' }, { code: 'A' }] },
    { type: 'chart', variant: 'decade-lines', series: [{ code: 'C' }, { code: 'D' }] },
  ];
  const slots = colourSlots(blocks);
  assert.deepEqual([...slots.entries()], [['A', 0], ['B', 1], ['C', 2], ['D', 3]]);
  assert.equal(colourVar(slots, 'B'), 'var(--explore-cat-2)');
  assert.equal(colourVar(slots, 'unknown'), 'var(--explore-not-coded)');
});
