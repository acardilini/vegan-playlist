// Pure region labelling for the Explore map: deterministic k-means over a space's coordinates,
// then a name for each region from what is OVER-represented there (lift), never from what is
// merely most common (that would give every region the catalogue's top genre). No database, no
// random source: the same input always gives the same labels, so a payload is stable between loads.

// How many regions a space is cut into. Curator feedback (2026-11-06): 12 felt like too many.
const REGION_K = 8;
// A region smaller than this is too small to name honestly.
const MIN_REGION = 15;

// A term must appear this many times in the region, in this share of it, and this many times
// more often than across the catalogue. Starting values; tuned once on the live data.
const MIN_TERM_COUNT = 5;
const MIN_TERM_SHARE = 0.2;
const MIN_TERM_LIFT = 1.6;
const MIN_GENRE_COUNT = 6;
const MIN_GENRE_SHARE = 0.3;
const MIN_GENRE_LIFT = 1.4;

const dist2 = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
  return s;
};

// Farthest-point start (no random source), then Lloyd's iterations. Lowest index wins every tie.
function kmeans(points, k, maxIter = 50) {
  const n = points.length;
  if (n === 0 || k <= 0) return { assignments: [], centres: [] };
  const kk = Math.min(k, n);
  const dims = points[0].length;

  const mean = new Array(dims).fill(0);
  for (const p of points) for (let d = 0; d < dims; d++) mean[d] += p[d] / n;
  let first = 0;
  let best = Infinity;
  points.forEach((p, i) => {
    const d = dist2(p, mean);
    if (d < best) { best = d; first = i; }
  });

  const chosen = [first];
  const nearest = points.map(p => dist2(p, points[first]));
  while (chosen.length < kk) {
    let pick = -1;
    let far = -1;
    for (let i = 0; i < n; i++) {
      if (chosen.includes(i)) continue;
      if (nearest[i] > far) { far = nearest[i]; pick = i; }
    }
    chosen.push(pick);
    for (let i = 0; i < n; i++) nearest[i] = Math.min(nearest[i], dist2(points[i], points[pick]));
  }
  let centres = chosen.map(i => points[i].slice());

  let assignments = new Array(n).fill(-1);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    const next = points.map((p, i) => {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = dist2(p, centres[c]);
        if (d < bd) { bd = d; bi = c; }
      }
      if (bi !== assignments[i]) changed = true;
      return bi;
    });
    assignments = next;
    if (!changed) break;
    const sums = centres.map(() => new Array(dims).fill(0));
    const counts = new Array(kk).fill(0);
    points.forEach((p, i) => {
      counts[assignments[i]] += 1;
      for (let d = 0; d < dims; d++) sums[assignments[i]][d] += p[d];
    });
    // an emptied cluster keeps its previous centre
    centres = centres.map((c, ci) => (counts[ci] ? sums[ci].map(v => v / counts[ci]) : c));
  }
  return { assignments, centres };
}

const round4 = (v) => Math.round(v * 10000) / 10000;

// The single best term in a region: eligible by the three thresholds, highest count * ln(lift)
// (distinctive AND substantial); ties go to the larger count, then the alphabetically first key.
function bestOf(inRegion, regionCount, overall, total, min) {
  let best = null;
  for (const [key, c] of inRegion) {
    const share = c / regionCount;
    const lift = share / (overall.get(key) / total);
    if (c < min.count || share < min.share || lift < min.lift) continue;
    const score = c * Math.log(lift);
    if (!best || score > best.score
      || (score === best.score && (c > best.c || (c === best.c && key < best.key)))) {
      best = { key, c, score };
    }
  }
  return best && best.key;
}

function buildRegionLabels(items, opts) {
  const {
    k = REGION_K, minRegion = MIN_REGION, labelOf, genreLabelOf,
  } = opts;
  if (!items.length) return [];
  const { assignments, centres } = kmeans(items.map(i => i.point), k);

  const overallTerms = new Map();
  const overallGenres = new Map();
  for (const it of items) {
    for (const t of it.terms) overallTerms.set(t, (overallTerms.get(t) || 0) + 1);
    if (it.genre) overallGenres.set(it.genre, (overallGenres.get(it.genre) || 0) + 1);
  }

  const named = [];
  for (let c = 0; c < centres.length; c++) {
    const members = items.filter((_, i) => assignments[i] === c);
    if (members.length < minRegion) continue;
    const terms = new Map();
    const genres = new Map();
    for (const it of members) {
      for (const t of it.terms) terms.set(t, (terms.get(t) || 0) + 1);
      if (it.genre) genres.set(it.genre, (genres.get(it.genre) || 0) + 1);
    }
    const term = bestOf(terms, members.length, overallTerms, items.length,
      { count: MIN_TERM_COUNT, share: MIN_TERM_SHARE, lift: MIN_TERM_LIFT });
    const genre = bestOf(genres, members.length, overallGenres, items.length,
      { count: MIN_GENRE_COUNT, share: MIN_GENRE_SHARE, lift: MIN_GENRE_LIFT });
    const label = [term && labelOf(term), genre && genreLabelOf(genre)].filter(Boolean).join(' · ');
    if (!label) continue;
    named.push({ label, centre: centres[c].map(round4), count: members.length, cluster: c });
  }

  // identical text keeps the larger region (ties: lower cluster index)
  const bySize = [...named].sort((a, b) => b.count - a.count || a.cluster - b.cluster);
  const seen = new Set();
  const kept = bySize.filter(l => (seen.has(l.label) ? false : (seen.add(l.label), true)));
  return kept.map(({ label, centre, count }) => ({ label, centre, count }));
}

module.exports = {
  kmeans, buildRegionLabels, REGION_K, MIN_REGION,
  MIN_TERM_COUNT, MIN_TERM_SHARE, MIN_TERM_LIFT, MIN_GENRE_COUNT, MIN_GENRE_SHARE, MIN_GENRE_LIFT,
};
