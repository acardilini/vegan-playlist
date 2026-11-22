import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAD, fmtTime, binFromX, xForBin, xForSec, secForBin, binForSec, stepBin, readout,
  activeSection, activeSample, spanBox, withAlpha,
} from './timelineModel.js';

const TL = {
  version: 'v1', bins: 80, duration_sec: 186, bin_sec: 2.325,
  loudness: Array.from({ length: 80 }, (_, i) => i / 100),
  grit: Array.from({ length: 80 }, () => 0.4),
  pulse: Array.from({ length: 80 }, () => 0.86),
};
const W = 816; // plot width = 816 - 8 - 8 = 800: ten pixels per bin

test('fmtTime is M:SS, rounds to the second, never negative, minutes may pass 59', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(65.4), '1:05');
  assert.equal(fmtTime(59.6), '1:00');
  assert.equal(fmtTime(-3), '0:00');
  assert.equal(fmtTime(4510), '75:10');
});

test('binFromX maps a pixel in the plot to its bin and clamps at both ends', () => {
  assert.equal(PAD.l + PAD.r, 16);
  assert.equal(binFromX(PAD.l, W, 80), 0);
  assert.equal(binFromX(PAD.l + 15, W, 80), 1);
  assert.equal(binFromX(PAD.l + 799, W, 80), 79);
  assert.equal(binFromX(-50, W, 80), 0, 'left of the plot');
  assert.equal(binFromX(9999, W, 80), 79, 'right of the plot');
});

test('xForBin is the centre of the bin and binFromX inverts it', () => {
  assert.equal(xForBin(0, W, 80), PAD.l + 5);
  for (const b of [0, 17, 40, 79]) assert.equal(binFromX(xForBin(b, W, 80), W, 80), b);
});

test('xForSec places a time on the plot', () => {
  assert.equal(xForSec(0, 186, W), PAD.l);
  assert.equal(xForSec(186, 186, W), PAD.l + 800);
  assert.equal(xForSec(93, 186, W), PAD.l + 400);
  assert.equal(xForSec(999, 186, W), PAD.l + 800, 'clamped to the end');
});

test('secForBin is the middle of the bin, capped at the duration; binForSec inverts and clamps', () => {
  assert.equal(secForBin(TL, 0), 2.325 / 2);
  assert.ok(Math.abs(secForBin(TL, 79) - 79.5 * 2.325) < 1e-9);
  assert.equal(secForBin({ ...TL, bin_sec: 3 }, 79), 186, 'never past the duration');
  assert.equal(binForSec(TL, 0), 0);
  assert.equal(binForSec(TL, 186), 79);
  assert.equal(binForSec(TL, 44), 18);
  assert.equal(binForSec(TL, -5), 0);
  assert.equal(binForSec(TL, 500), 79);
});

test('stepBin: arrows step one bin, Home and End jump, the ends are clamped, other keys return null', () => {
  assert.equal(stepBin(10, 'ArrowRight', 80), 11);
  assert.equal(stepBin(10, 'ArrowLeft', 80), 9);
  assert.equal(stepBin(0, 'ArrowLeft', 80), 0);
  assert.equal(stepBin(79, 'ArrowRight', 80), 79);
  assert.equal(stepBin(10, 'Home', 80), 0);
  assert.equal(stepBin(10, 'End', 80), 79);
  assert.equal(stepBin(10, 'a', 80), null);
});

test('readout gives whole percentages and the clock for a bin', () => {
  const r = readout(TL, 30);
  assert.deepEqual(r, { time: '1:11', total: '3:06', loudness: 30, grit: 40, pulse: 86 });
});

const SECTIONS = [
  { startSec: 0, endSec: 15, label: '0:00–0:15', text: 'Intro.' },
  { startSec: 16, endSec: 83, label: '0:16–1:23', text: 'Groove.' },
  { startSec: 124, endSec: 174, label: '2:04–2:54', text: 'Build.' },
];

test('activeSection: the section containing the time, else the one nearest in time, else null', () => {
  assert.equal(activeSection(SECTIONS, 5).text, 'Intro.');
  assert.equal(activeSection(SECTIONS, 83).text, 'Groove.', 'the end is inclusive');
  assert.equal(activeSection(SECTIONS, 90).text, 'Groove.', 'in the 1:23-2:04 gap: 7s after Groove ends, 34s before Build starts');
  assert.equal(activeSection(SECTIONS, 100).text, 'Groove.', 'still nearer Groove (17s) than Build (24s)');
  assert.equal(activeSection(SECTIONS, 110).text, 'Build.', 'now nearer Build (14s)');
  assert.equal(activeSection(SECTIONS, 180).text, 'Build.', 'past the last section: the last one');
  assert.equal(activeSection([], 5), null);
  assert.equal(activeSection(null, 5), null);
  const untimed = [{ startSec: null, endSec: null, label: null, text: 'A note.' }];
  assert.equal(activeSection(untimed, 5), null, 'untimed notes are never "active"');
});

const SAMPLES = [
  { type: 'A', startSec: 0, endSec: 10 },
  { type: 'A', startSec: 44, endSec: 53 },
  { type: 'B', startSec: 151, endSec: 174 },
  { type: 'C', startSec: null, endSec: null },
];

test('activeSample: a clip under the time (1.5s grace) is a hit; otherwise the closest clip, not a hit', () => {
  assert.deepEqual(activeSample(SAMPLES, 48), { item: SAMPLES[1], hit: true });
  assert.deepEqual(activeSample(SAMPLES, 54.2), { item: SAMPLES[1], hit: true }, 'inside the grace');
  assert.deepEqual(activeSample(SAMPLES, 100), { item: SAMPLES[1], hit: false }, 'nearest by midpoint (48.5 vs 162.5)');
  assert.equal(activeSample(SAMPLES, 120).item, SAMPLES[2]);
  assert.equal(activeSample([], 5), null);
  assert.equal(activeSample(null, 5), null);
  assert.equal(activeSample([{ type: 'C', startSec: null, endSec: null }], 5), null, 'clips with no usable time are ignored');
});

test('spanBox puts a clip on the plot and keeps a very short clip visible', () => {
  const b = spanBox({ startSec: 93, endSec: 186 }, TL, W);
  assert.equal(b.x1, PAD.l + 400);
  assert.equal(b.x2, PAD.l + 800);
  const point = spanBox({ startSec: 120, endSec: 120 }, TL, W);
  assert.equal(point.x2 - point.x1, 4, 'a zero-length clip is 4px wide');
  const near = spanBox({ startSec: 185, endSec: 186 }, TL, W);
  assert.ok(near.x2 <= PAD.l + 800 + 4);
});

test('withAlpha turns a hex colour into rgba', () => {
  assert.equal(withAlpha('#e8601f', 0.5), 'rgba(232, 96, 31, 0.5)');
  assert.equal(withAlpha('#fff', 1), 'rgba(255, 255, 255, 1)');
  assert.equal(withAlpha('not-a-colour', 0.3), 'rgba(128, 128, 128, 0.3)', 'a safe grey rather than a throw');
});
