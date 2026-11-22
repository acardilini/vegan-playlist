// Pure aggregation for the Explore > Data tabs. No DOM, no React: everything the charts draw is computed here from
// the one /api/analytics/dataset payload, so node --test can exercise it directly.

// Below these sizes a figure is withheld or hedged rather than stated confidently.
export const MIN_GROUP_FOR_SENTENCE = 30; // a "led with about N%" sentence needs this many songs
export const MIN_POINT_N = 10;            // a decade point (tone share, median) needs this many songs
export const TOP_GENRES = 6;              // genres that get their own colour; the rest fold into grey Other
export const TOP_TONES = 5;

const OTHER = 'other';

export function yearBounds(songs) {
  let min = Infinity;
  let max = -Infinity;
  for (const s of songs) {
    if (s.y == null) continue;
    if (s.y < min) min = s.y;
    if (s.y > max) max = s.y;
  }
  return min === Infinity ? null : { min, max };
}

// Songs with no release year pass only while the year window is untouched (undated songs cannot be placed in a window).
export function filterSongs(songs, { pg, yf, yt }, bounds) {
  const narrowed = bounds && yf != null && yt != null && (yf > bounds.min || yt < bounds.max);
  return songs.filter(s => {
    if (pg && s.g !== pg) return false;
    if (narrowed && (s.y == null || s.y < yf || s.y > yt)) return false;
    return true;
  });
}

export function computeKpis(songs) {
  return {
    songs: songs.length,
    withGenre: songs.filter(s => s.g).length,
    audio: songs.filter(s => s.ha).length,
    lyric: songs.filter(s => s.hl).length,
  };
}

function rank(items, key) {
  const counts = new Map();
  for (const it of items) {
    const k = key(it);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export function genreRanking(songs) {
  return rank(songs, s => s.g).map(([g, n]) => ({ g, n }));
}

export function median(values) {
  const v = values.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Colour follows the entity, never its rank in the current slice: `order` is the fixed colour order (the ranking of the
// whole catalogue), so filtering to one genre does not repaint it. A key past the first `top` of `order` folds into Other.
function foldSeries(rows, order, top, valueOf) {
  const coloured = order.slice(0, top);
  const bucketOf = k => (coloured.includes(k) ? k : OTHER);
  const present = new Set(rows.map(r => bucketOf(r.key)));
  const series = coloured.filter(k => present.has(k)).map(k => ({ key: k, colourIndex: order.indexOf(k) }));
  if (present.has(OTHER)) series.push({ key: OTHER, colourIndex: null });
  return series.map(s => ({ ...s, values: valueOf(k => bucketOf(k) === s.key) }));
}

const pad = n => String(n).slice(-2);

export function buildEraSeries(songs, { bucket = '5y', mode = 'count', order, top = TOP_GENRES } = {}) {
  const items = songs.filter(s => s.y != null && s.g);
  const size = bucket === '1y' ? 1 : 5;
  const startOf = y => y - (y % size);
  const fixed = order || genreRanking(songs).map(r => r.g);
  if (!items.length) return { eras: [], series: [], n: 0 };

  const first = startOf(Math.min(...items.map(s => s.y)));
  const last = startOf(Math.max(...items.map(s => s.y)));
  const eras = [];
  for (let start = first; start <= last; start += size) {
    eras.push({ start, label: size === 1 ? String(start) : `${start}–${pad(start + size - 1)}`, total: 0 });
  }
  const at = new Map(eras.map((e, i) => [e.start, i]));
  for (const s of items) eras[at.get(startOf(s.y))].total += 1;

  const rows = items.map(s => ({ key: s.g, era: at.get(startOf(s.y)) }));
  const series = foldSeries(rows, fixed, top, matches => {
    const counts = eras.map(() => 0);
    for (const r of rows) if (matches(r.key)) counts[r.era] += 1;
    return mode === 'share' ? counts.map((c, i) => (eras[i].total ? c / eras[i].total : 0)) : counts;
  });
  return { eras, series, n: items.length };
}

const decadeOf = y => Math.floor(y / 10) * 10;

function decadeRange(items) {
  const ds = items.map(s => decadeOf(s.y));
  const out = [];
  for (let d = Math.min(...ds); d <= Math.max(...ds); d += 10) out.push(d);
  return out;
}

export function buildToneByDecade(songs, { minN = MIN_POINT_N, order, top = TOP_TONES } = {}) {
  const items = songs.filter(s => s.hl && s.tone && s.y != null);
  if (!items.length) return { decades: [], series: [], n: 0 };
  const fixed = order || rank(items, s => s.tone).map(([k]) => k);
  const decades = decadeRange(items).map(decade => {
    const n = items.filter(s => decadeOf(s.y) === decade).length;
    return { decade, n, plot: n >= minN };
  });
  const index = new Map(decades.map((d, i) => [d.decade, i]));
  const rows = items.map(s => ({ key: s.tone, dec: index.get(decadeOf(s.y)) }));
  const series = foldSeries(rows, fixed, top, matches => {
    const counts = decades.map(() => 0);
    for (const r of rows) if (matches(r.key)) counts[r.dec] += 1;
    return counts.map((c, i) => (decades[i].plot ? c / decades[i].n : null));
  });
  return { decades, series, n: items.length };
}

// "In the 1980s Punk led, with about 49% of songs with a genre." Written only when the decade has enough songs.
export function topGenreSentence(songs, decade, labels, minGroup = MIN_GROUP_FOR_SENTENCE) {
  const inDecade = songs.filter(s => s.y != null && s.g && decadeOf(s.y) === decade);
  if (inDecade.length < minGroup) return null;
  const [top] = genreRanking(inDecade);
  const pct = Math.round((top.n / inDecade.length) * 100);
  const name = (labels && labels[top.g]) || top.g;
  return `In the ${decade}s ${name} led, with about ${pct}% of songs that have a genre.`;
}

// At most two sentences: the earliest and the latest decade that has enough songs to say anything.
export function insightSentences(songs, labels) {
  const dated = songs.filter(s => s.y != null && s.g);
  if (!dated.length) return [];
  const lines = decadeRange(dated).map(d => topGenreSentence(songs, d, labels)).filter(Boolean);
  if (lines.length <= 2) return lines;
  return [lines[0], lines[lines.length - 1]];
}
