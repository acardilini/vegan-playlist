// Pure model for the song page's audio timeline ("Through the song"): where a pixel, a bin and a time sit on the plot, what
// the cursor reads out, and which section and sample clip are under it. No React, no DOM, so it runs under `node --test`.
// The canvas drawing lives in components/timelineDraw.js; the shapes come from backend/services/audioAnalysis.js
// (`timeline`: 80 bins of loudness / grit / pulse in 0..1; `sections` and `samples.items` carry startSec / endSec).

// Plot padding in CSS pixels, shared by drawing and hit-testing so the two can never disagree.
export const PAD = { l: 8, r: 8, t: 10, b: 22 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const plotWidth = (width) => Math.max(1, width - PAD.l - PAD.r);

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The bin under a pixel x (canvas CSS pixels), clamped to the plot.
export function binFromX(x, width, bins) {
  const frac = clamp((x - PAD.l) / plotWidth(width), 0, 0.999999);
  return Math.floor(frac * bins);
}

// The pixel x of a bin's centre.
export function xForBin(bin, width, bins) {
  return PAD.l + ((bin + 0.5) / bins) * plotWidth(width);
}

// The pixel x of a time, clamped to the plot.
export function xForSec(sec, duration, width) {
  return PAD.l + clamp(sec / duration, 0, 1) * plotWidth(width);
}

// The middle of a bin in seconds, never past the end of the song.
export function secForBin(tl, bin) {
  return Math.min(tl.duration_sec, (bin + 0.5) * tl.bin_sec);
}

export function binForSec(tl, sec) {
  return clamp(Math.floor(sec / tl.bin_sec), 0, tl.bins - 1);
}

// Keyboard: the new bin for an arrow / Home / End key, or null when the key is not ours.
export function stepBin(bin, key, bins) {
  if (key === 'ArrowRight') return Math.min(bins - 1, bin + 1);
  if (key === 'ArrowLeft') return Math.max(0, bin - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return bins - 1;
  return null;
}

// What the strip under the chart shows for a bin: the clock and whole percentages.
export function readout(tl, bin) {
  return {
    time: fmtTime(secForBin(tl, bin)),
    total: fmtTime(tl.duration_sec),
    loudness: Math.round(tl.loudness[bin] * 100),
    grit: Math.round(tl.grit[bin] * 100),
    pulse: Math.round(tl.pulse[bin] * 100),
  };
}

// The timed section under a time. In a gap between sections the nearest one in time stays shown (the analysis simply
// had nothing to say there); untimed notes are never "active"; null when there is no timed section at all.
export function activeSection(sections, sec) {
  const timed = (Array.isArray(sections) ? sections : []).filter((s) => s && s.startSec != null && s.endSec != null);
  if (timed.length === 0) return null;
  const distance = (s) => (sec < s.startSec ? s.startSec - sec : (sec > s.endSec ? sec - s.endSec : 0));
  return timed.reduce((best, s) => (distance(s) < distance(best) ? s : best), timed[0]);
}

// The sample clip under a time (with a little grace either side, as clips are short), or else the closest clip by its
// middle, flagged as not a hit. null when no clip has a usable time.
export function activeSample(items, sec, grace = 1.5) {
  const timed = (Array.isArray(items) ? items : []).filter((s) => s && s.startSec != null && s.endSec != null);
  if (timed.length === 0) return null;
  const hit = timed.find((s) => sec >= s.startSec - grace && sec <= s.endSec + grace);
  if (hit) return { item: hit, hit: true };
  const mid = (s) => (s.startSec + s.endSec) / 2;
  return { item: timed.reduce((best, s) => (Math.abs(mid(s) - sec) < Math.abs(mid(best) - sec) ? s : best), timed[0]), hit: false };
}

// The horizontal extent of a clip on the plot; a very short clip keeps a minimum width so it can still be seen.
export function spanBox(item, tl, width, minWidth = 4) {
  const x1 = xForSec(item.startSec, tl.duration_sec, width);
  const x2 = Math.max(x1 + minWidth, xForSec(item.endSec, tl.duration_sec, width));
  return { x1, x2 };
}

// '#rrggbb' or '#rgb' -> 'rgba(r, g, b, a)'; a mid grey for anything else, so a bad token never throws mid-draw.
export function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return `rgba(128, 128, 128, ${alpha})`;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
