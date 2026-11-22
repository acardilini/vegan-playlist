// Pure model for Explore > Data > Arguments: the three-column flow (alluvial) between categorical fields, the pathway
// list and the theme-pair list. No DOM, no React, no layout: everything is computed from the one dataset payload so
// node --test can exercise it directly. A song counts under its FIRST VALID code in each column (the payload carries
// only that code per field), and needs a value in all three of a preset's fields to be in a flow.
import { MIN_GROUP_FOR_SENTENCE } from './dataModel.js';

export const TOP_NODES = 6;     // codes per column that get their own node; the rest fold into one Other node
export const MIN_PAIR_N = 3;    // a theme pair needs this many songs to be listed
export const TOP_PAIRS = 10;    // theme pairs listed
export const TOP_PATHS = 10;    // pathways listed

const OTHER_KEY = 'other';
const OTHER_LABEL = 'Other';
const SEP = '\u0001';

export const PRESETS = [
  {
    id: 'genre-tone-action',
    label: 'Genre, tone, action',
    columns: [
      { field: 'g', name: 'Genre', labelKey: 'genres' },
      { field: 'tone', name: 'Lyrical tone', labelKey: 'tone' },
      { field: 'act', name: 'Advocacy action', labelKey: 'act' },
    ],
    browseKeys: ['parent_genres', 'lyrical_tone', 'actions'],
  },
  {
    id: 'audience-frame-action',
    label: 'Audience, frame, action',
    columns: [
      { field: 'aud', name: 'Speaking to', labelKey: 'aud' },
      { field: 'frm', name: 'Moral frame', labelKey: 'frm' },
      { field: 'act', name: 'Advocacy action', labelKey: 'act' },
    ],
    browseKeys: ['target_audience', 'moral_frames', 'actions'],
  },
  {
    id: 'voice-tone-emotion',
    label: 'Voice, tone, emotion',
    columns: [
      { field: 'avoc', name: 'Vocal style', labelKey: 'avoc' },
      { field: 'tone', name: 'Lyrical tone', labelKey: 'tone' },
      { field: 'emo', name: 'Emotion', labelKey: 'emo' },
    ],
    browseKeys: ['vocal_style', 'lyrical_tone', 'emotions'],
  },
];

const titleCase = code => String(code).split(/[_\s-]+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const labelOf = (dict, code) => (dict && dict[code]) || titleCase(code);

const byLabel = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// count desc, then label asc, then code asc (so the order never depends on input order)
function rankCodes(counts, dict) {
  return [...counts.entries()]
    .map(([code, n]) => ({ code, n, label: labelOf(dict, code) }))
    .sort((a, b) => b.n - a.n || byLabel(a.label, b.label) || byLabel(a.code, b.code));
}

function buildColumn(counts, column, labels, firstOrder, withSlots) {
  const dict = labels && labels[column.labelKey];
  const ranked = rankCodes(counts, dict);
  const top = ranked.slice(0, TOP_NODES);
  const rest = ranked.slice(TOP_NODES);
  const nodes = top.map(r => ({ key: r.code, label: r.label, n: r.n, other: false, slot: null }));

  if (withSlots) {
    const used = new Set();
    for (const node of nodes) {
      const at = firstOrder.indexOf(node.key);
      if (at >= 0 && at < TOP_NODES && !used.has(at)) { node.slot = at; used.add(at); }
    }
    let next = 0;
    for (const node of nodes) {
      if (node.slot !== null) continue;
      while (used.has(next)) next += 1;
      node.slot = next;
      used.add(next);
    }
  }

  let otherKey = OTHER_KEY;
  if (rest.length) {
    // a real code can itself be "other" (the genre hierarchy has one); keep the folded node's key distinct from it
    if (nodes.some(x => x.key === OTHER_KEY)) otherKey = `_${OTHER_KEY}`;
    nodes.push({ key: otherKey, label: OTHER_LABEL, n: rest.reduce((s, r) => s + r.n, 0), other: true, slot: null });
  }
  const keyOf = new Map(top.map(r => [r.code, r.code]));
  for (const r of rest) keyOf.set(r.code, otherKey);
  return { name: column.name, nodes, keyOf, otherKey: rest.length ? otherKey : null };
}

function foldLinks(pairs, fromOf, toOf, columns, k) {
  const counts = new Map();
  for (const [a, b] of pairs) {
    const from = fromOf.get(a);
    const to = toOf.get(b);
    const id = from + SEP + to;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const labelFor = (col, key) => col.nodes.find(x => x.key === key).label;
  return [...counts.entries()]
    .map(([id, n]) => {
      const [from, to] = id.split(SEP);
      return { from, to, n, fl: labelFor(columns[k], from), tl: labelFor(columns[k + 1], to) };
    })
    .sort((a, b) => b.n - a.n || byLabel(a.fl, b.fl) || byLabel(a.tl, b.tl))
    .map(({ from, to, n }) => ({ from, to, n }));
}

export function buildFlow(songs, preset, { labels = {}, firstOrder = [] } = {}) {
  const fields = preset.columns.map(c => c.field);
  const eligible = songs.filter(s => fields.every(f => s[f] != null && s[f] !== ''));
  if (!eligible.length) return { preset, n: 0, columns: [], links: [], paths: [] };

  const built = preset.columns.map((column, i) => {
    const counts = new Map();
    for (const s of eligible) counts.set(s[column.field], (counts.get(s[column.field]) || 0) + 1);
    return buildColumn(counts, column, labels, firstOrder, i === 0);
  });
  const columns = built.map(b => ({ name: b.name, nodes: b.nodes }));

  const triples = eligible.map(s => fields.map(f => s[f]));
  const links = [0, 1].map(k => foldLinks(
    triples.map(t => [t[k], t[k + 1]]), built[k].keyOf, built[k + 1].keyOf, columns, k,
  ));

  const pathCounts = new Map();
  for (const t of triples) {
    const keys = t.map((code, i) => built[i].keyOf.get(code));
    const id = keys.join(SEP);
    pathCounts.set(id, (pathCounts.get(id) || 0) + 1);
  }
  const labelFor = (i, key) => columns[i].nodes.find(x => x.key === key).label;
  const paths = [...pathCounts.entries()]
    .map(([id, n]) => {
      const keys = id.split(SEP);
      return { keys, labels: keys.map((k, i) => labelFor(i, k)), n };
    })
    .sort((a, b) => b.n - a.n || byLabel(a.labels.join(SEP), b.labels.join(SEP)));

  return { preset, n: eligible.length, columns, links, paths };
}

const isOtherKey = (flow, col, key) => flow.columns[col].nodes.some(x => x.key === key && x.other);

// One sentence, every figure from the data. Withheld on a thin flow, and when no link joins two named nodes.
export function strongestSentence(flow) {
  if (flow.n < MIN_GROUP_FOR_SENTENCE) return null;
  const label = (col, key) => flow.columns[col].nodes.find(x => x.key === key).label;
  const top = flow.links[0].find(l => !isOtherKey(flow, 0, l.from) && !isOtherKey(flow, 1, l.to));
  if (!top) return null;
  const pct = Math.round((top.n / flow.n) * 100);
  const [c0, c1] = flow.columns;
  const noun = top.n === 1 ? 'song' : 'songs';
  return `Strongest link, ${c0.name} to ${c1.name}: ${label(0, top.from)} to ${label(1, top.to)}, ${top.n} ${noun} (about ${pct}% of the pathway songs).`;
}

export function topPathways(flow, limit = TOP_PATHS) {
  return flow.paths
    .filter(p => !p.keys.some((k, i) => isOtherKey(flow, i, k)))
    .slice(0, limit);
}

export function flowTable(flow) {
  const rows = [];
  flow.links.forEach((links, k) => {
    const pair = `${flow.columns[k].name} to ${flow.columns[k + 1].name}`;
    const label = (col, key) => flow.columns[col].nodes.find(x => x.key === key).label;
    for (const l of links) rows.push([pair, label(k, l.from), label(k + 1, l.to), l.n]);
  });
  return { head: ['Columns', 'From', 'To', 'Songs'], rows };
}

// Pairs of distinct themes on one song, each pair counted once per song. `n` is the songs with at least one theme.
export function topThemePairs(songs, { labels = {}, minN = MIN_PAIR_N, limit = TOP_PAIRS } = {}) {
  const dict = labels.thm;
  let n = 0;
  const counts = new Map();
  for (const s of songs) {
    const codes = [...new Set(s.thm || [])].sort();
    if (!codes.length) continue;
    n += 1;
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const id = codes[i] + SEP + codes[j];
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
  }
  const pairs = [...counts.entries()]
    .filter(([, c]) => c >= minN)
    .map(([id, c]) => {
      const [a, b] = id.split(SEP);
      return { a, b, aLabel: labelOf(dict, a), bLabel: labelOf(dict, b), n: c, share: c / n };
    })
    .sort((x, y) => y.n - x.n || byLabel(x.aLabel, y.aLabel) || byLabel(x.bLabel, y.bLabel))
    .slice(0, limit);
  return { n, pairs };
}

export function pairsTable(result) {
  return {
    head: ['Theme', 'With', 'Songs', 'Share'],
    rows: result.pairs.map(p => [p.aLabel, p.bLabel, p.n, `${Math.round(p.share * 100)}%`]),
  };
}

// Geometry for the flow: pure numbers, no DOM. ONE scale (pixels per song) is shared by every column so equal totals
// give equal column heights. Each column is a stack of nodes with `gap` between, centred vertically. A ribbon is a cubic
// Bezier centre line (stroke it `thickness` wide) from the right edge of its source node to the left edge of its target,
// attached at stacked offsets inside both nodes: leaving in link order, entering in link order.
export function flowLayout(flow, { width, height, nodeWidth = 14, gap = 10, labelPad = 0 } = {}) {
  if (!flow.n || !flow.columns.length) return { nodes: [], ribbons: [], scale: 0 };

  const cols = flow.columns.length;
  const widthSafe = Math.max(0, width);
  const span = Math.max(0, widthSafe - 2 * labelPad - nodeWidth);
  const xOf = col => labelPad + (cols > 1 ? (span * col) / (cols - 1) : 0);

  // the tallest column (by node count) decides how much room the gaps take; one scale then fits every column
  let scale = Infinity;
  for (const column of flow.columns) {
    const total = column.nodes.reduce((s, x) => s + x.n, 0);
    if (!total) continue;
    const room = Math.max(0, height - gap * (column.nodes.length - 1));
    scale = Math.min(scale, room / total);
  }
  if (!Number.isFinite(scale)) scale = 0;

  const nodes = [];
  const at = new Map(); // `${col}\u0001${key}` -> placed node
  flow.columns.forEach((column, col) => {
    const stack = column.nodes.reduce((s, x) => s + x.n * scale, 0) + gap * Math.max(0, column.nodes.length - 1);
    let y = Math.max(0, (height - stack) / 2);
    for (const node of column.nodes) {
      const placed = {
        col, key: node.key, label: node.label, n: node.n, other: node.other, slot: node.slot,
        x: xOf(col), y, w: nodeWidth, h: node.n * scale,
      };
      nodes.push(placed);
      at.set(col + SEP + node.key, placed);
      y += placed.h + gap;
    }
  });

  const ribbons = [];
  flow.links.forEach((links, k) => {
    const outUsed = new Map(); // offset already taken on a source node's right side
    const inUsed = new Map();  // ... on a target node's left side
    for (const link of links) {
      const a = at.get(k + SEP + link.from);
      const b = at.get(k + 1 + SEP + link.to);
      const thickness = link.n * scale;
      const y0 = a.y + (outUsed.get(a) || 0) + thickness / 2;
      const y1 = b.y + (inUsed.get(b) || 0) + thickness / 2;
      outUsed.set(a, (outUsed.get(a) || 0) + thickness);
      inUsed.set(b, (inUsed.get(b) || 0) + thickness);
      const x0 = a.x + a.w;
      const x1 = b.x;
      const xm = (x0 + x1) / 2;
      ribbons.push({ fromCol: k, from: link.from, to: link.to, n: link.n, d: `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1}`, thickness });
    }
  });

  return { nodes, ribbons, scale };
}

// The Browse filters that mean "the songs on these picked nodes": one Browse key per column, from the preset. An Other
// node (flagged `other`, never recognised by its key: a real genre can be called "other") and a part with no key are skipped.
export function browseSelectionFor(preset, parts) {
  const out = {};
  for (const part of parts) {
    if (!part || part.other || !part.key) continue;
    const browseKey = preset.browseKeys[part.col];
    if (!browseKey) continue;
    out[browseKey] = [...new Set([...(out[browseKey] || []), part.key])];
  }
  return out;
}
