// Data stories: scrollytelling stories read from editable Markdown files (backend/data/stories/*.md).
// This file has two halves. The PARSER (pure, no DB) turns a story file into blocks and resolves {{tokens}};
// the PROVIDERS and LOADER (below, added later) read live-song data so that the numbers in the prose and in the
// charts come from the same functions. Read-only; never touches lyric text, transcripts or audio samples.

class StoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoryError';
    this.code = code; // BAD_FORMAT | BAD_TOKEN | BAD_BLOCK | SONG_NOT_LIVE | NOT_FOUND
  }
}

const PANEL_KINDS = new Set(['opening', 'chart', 'songs', 'closing']);
const ARG_RE = /([A-Za-z][\w-]*)=(?:"([^"]*)"|(\S+))/g;
const SONG_ROW_RE = /^\s*(\d+)\s*\|\s*(.*?)\s*$/;

function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) throw new StoryError('BAD_FORMAT', 'Story must start with a --- front matter block');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  if (!meta.title) throw new StoryError('BAD_FORMAT', 'Story front matter needs a title');
  const order = Number(meta.order);
  return {
    meta: { title: meta.title, subtitle: meta.subtitle || '', order: Number.isFinite(order) && meta.order !== undefined ? order : 100 },
    body: text.slice(m[0].length),
  };
}

function parseArgs(rest) {
  const args = {};
  for (const m of rest.matchAll(ARG_RE)) args[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return args;
}

// Story text -> { meta, blocks }. Block lines start with @; everything between them is Markdown prose.
function parseStory(raw) {
  const { meta, body } = parseFrontMatter(String(raw).replace(/\r\n?/g, '\n'));
  const blocks = [];
  let prose = [];
  let songs = null; // the open @songs block, collecting rows

  const flushProse = () => {
    const markdown = prose.join('\n').trim();
    if (markdown) blocks.push({ type: 'prose', markdown });
    prose = [];
  };

  for (const line of body.split('\n')) {
    if (songs) {
      const row = SONG_ROW_RE.exec(line);
      if (row) { songs.rows.push({ id: Number(row[1]), caption: row[2] }); continue; }
      if (!line.trim()) continue;
      songs = null; // first non-row, non-blank line ends the block and is handled below
    }
    const t = line.trim();
    if (t.startsWith('@')) {
      flushProse();
      const m = /^@(\w+)\s*(.*)$/.exec(t);
      const kind = m && m[1];
      if (!kind || !PANEL_KINDS.has(kind)) throw new StoryError('BAD_BLOCK', `Unknown block "${t.split(/\s/)[0]}"`);
      let rest = m[2];
      const block = { type: 'panel', kind, args: {} };
      if (kind === 'chart') {
        const v = /^([A-Za-z][\w-]*)(?=\s|$)(?!=)/.exec(rest);
        if (!v) throw new StoryError('BAD_BLOCK', '@chart needs a variant, for example @chart decade-bars');
        block.variant = v[1];
        rest = rest.slice(v[0].length);
      }
      block.args = parseArgs(rest);
      if (kind === 'songs') { block.rows = []; songs = block; }
      blocks.push(block);
    } else {
      prose.push(line);
    }
  }
  flushProse();
  return { meta, blocks };
}

const TOKEN_RE = /\{\{\s*(\w+)((?:\s+[^\s{}]+)*)\s*\}\}/g;

function findTokens(markdown) {
  return [...String(markdown).matchAll(TOKEN_RE)].map(m => ({
    raw: m[0], name: m[1], args: m[2].trim() ? m[2].trim().split(/\s+/) : [],
  }));
}

// Splice resolve(name, args) into every {{token}}. Anything the resolver throws is a BAD_TOKEN (a StoryError passes through).
function applyTokens(markdown, resolve) {
  return String(markdown).replace(TOKEN_RE, (raw, name, argText) => {
    try {
      return String(resolve(name, argText.trim() ? argText.trim().split(/\s+/) : []));
    } catch (err) {
      if (err instanceof StoryError) throw err;
      throw new StoryError('BAD_TOKEN', `Token ${raw} could not be resolved`);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// PROVIDERS: live-song data for panels and tokens. Charts and prose both read these, so they cannot disagree.
// ---------------------------------------------------------------------------------------------------------------
const analysis = require('./analysis');
const audioAnalysis = require('./audioAnalysis');
const acoustic = require('./acousticCodebook');
const metadata = require('./metadataCodebook');

const LIVE = `s.status = 'included' AND s.published = true`;
const MIN_POINT_N = 10; // a decade with fewer songs is withheld, never plotted and never quoted

// `kind` decides which latest-pass view the column lives in. The keys double as the SQL identifier whitelist.
const DIMENSIONS = {
  vocal_style: { kind: 'audio-multi', noun: 'vocal style', basis: 'sound-analysed', clean: (v) => acoustic.cleanSelection('vocal_style', v), label: (c) => acoustic.codeLabel('vocal_style', c) },
  lyrical_tone: { kind: 'lyric-scalar', noun: 'tone', basis: 'lyric-coded', clean: (v) => metadata.cleanSelection('lyrical_tone', v), label: (c) => metadata.codeLabel('lyrical_tone', c) },
};

function dimensionOf(name) {
  if (!Object.prototype.hasOwnProperty.call(DIMENSIONS, name)) throw new StoryError('BAD_BLOCK', `Unknown dimension "${name}"`);
  return DIMENSIONS[name];
}

// Share of songs carrying each code, per decade of album release. `n` counts the songs the dimension was read for
// (an OK audio row, or a publicly visible lyric analysis), so for a multi-value dimension shares can add to > 100%.
async function decadeShares(db, dimension) {
  const dim = dimensionOf(dimension);
  const source = dim.kind.startsWith('audio') ? audioAnalysis.LATEST_AUDIO : analysis.LATEST_ANALYSIS;
  const r = await db.query(
    `SELECT (EXTRACT(YEAR FROM al.release_date)::int / 10 * 10) AS decade, src.${dimension} AS codes
       FROM songs s
       JOIN albums al ON al.id = s.album_id
       JOIN ${source} src ON src.song_id = s.id
      WHERE ${LIVE} AND al.release_date IS NOT NULL`);
  const byDecade = new Map();
  const labels = {};
  for (const row of r.rows) {
    const d = byDecade.get(row.decade) || { decade: row.decade, n: 0, counts: {} };
    d.n += 1;
    for (const code of new Set(dim.clean(row.codes))) {
      d.counts[code] = (d.counts[code] || 0) + 1;
      labels[code] = dim.label(code);
    }
    byDecade.set(row.decade, d);
  }
  const decades = [...byDecade.values()].sort((a, b) => a.decade - b.decade).map((d) => ({
    decade: d.decade,
    n: d.n,
    plot: d.n >= MIN_POINT_N,
    shares: Object.fromEntries(Object.entries(d.counts).map(([code, c]) => [code, c / d.n])),
  }));
  return { dimension, decades, labels };
}

function decadeEntry(result, decade) {
  const d = result.decades.find((x) => x.decade === Number(decade));
  if (!d) throw new StoryError('BAD_TOKEN', `No songs in the ${decade}s for ${result.dimension}`);
  if (!d.plot) throw new StoryError('BAD_TOKEN', `The ${decade}s have fewer than ${MIN_POINT_N} songs for ${result.dimension}`);
  return d;
}

// "46%": the share of songs carrying `code` in `decade`. Throws BAD_TOKEN for a withheld decade or an unknown code.
function pct(result, code, decade) {
  const d = decadeEntry(result, decade);
  if (!dimensionOf(result.dimension).clean([code]).length) throw new StoryError('BAD_TOKEN', `Unknown code "${code}" for ${result.dimension}`);
  return `${Math.round((d.shares[code] || 0) * 100)}%`;
}

function nOf(result, decade) {
  return String(decadeEntry(result, decade).n);
}

// Song cards for a story: only what the card shows. A song that is not live fails the story loudly.
async function songCards(db, rows) {
  const ids = rows.map((x) => x.id);
  const r = await db.query(
    `SELECT s.id, s.title, EXTRACT(YEAR FROM al.release_date)::int AS year, al.images->0->>'url' AS art,
            (SELECT string_agg(a.name, ', ' ORDER BY sa.id)
               FROM song_artists sa JOIN artists a ON a.id = sa.artist_id WHERE sa.song_id = s.id) AS artists
       FROM songs s LEFT JOIN albums al ON al.id = s.album_id
      WHERE s.id = ANY($1::int[]) AND ${LIVE}`, [ids]);
  const byId = new Map(r.rows.map((x) => [x.id, x]));
  return rows.map(({ id, caption }) => {
    const s = byId.get(id);
    if (!s) throw new StoryError('SONG_NOT_LIVE', `Song ${id} is not a live song`);
    return { id, title: s.title, artists: s.artists || '', year: s.year, art: s.art || null, caption };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// LOADER: story file -> a resolved story the page can render without further lookups.
// ---------------------------------------------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'stories');

// slug -> file, built from the files that exist. The request's slug is only ever a Map key, never part of a path,
// so traversal is impossible by construction (the routes/content.js pattern).
function storyFiles(dir) {
  const files = new Map();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* no stories directory yet */ }
  for (const name of names) {
    const m = /^([a-z0-9][a-z0-9-]*)\.md$/.exec(name);
    if (m) files.set(m[1], path.join(dir, name));
  }
  return files;
}

const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

function cleanCodes(dim, dimension, value) {
  const codes = csv(value);
  if (!codes.length) throw new StoryError('BAD_BLOCK', `@chart on ${dimension} needs codes=`);
  for (const c of codes) {
    if (!dim.clean([c]).length) throw new StoryError('BAD_BLOCK', `Unknown ${dimension} code "${c}"`);
  }
  return codes;
}

function captionFor(dimension, n, scope) {
  const dim = DIMENSIONS[dimension];
  const multi = dim.kind.endsWith('multi')
    ? ` A song can have more than one ${dim.noun}, so shares add to more than 100%.` : '';
  return `Based on ${n} ${dim.basis} songs ${scope}.${multi}`;
}

function browseHref(spec) {
  const pairs = csv(spec).map((p) => p.split(':'));
  if (!pairs.length || pairs.some(([k, v]) => !/^[a-z_]+$/.test(k) || !v)) {
    throw new StoryError('BAD_BLOCK', '@closing needs browse=key:value[,key:value]');
  }
  return `/?${new URLSearchParams(pairs.map(([k, ...v]) => [k, v.join(':')])).toString()}`;
}

async function loadStory(db, slug, dir = DEFAULT_DIR) {
  const file = typeof slug === 'string' ? storyFiles(dir).get(slug) : undefined;
  if (!file) throw new StoryError('NOT_FOUND', 'No such story');
  const { meta, blocks } = parseStory(fs.readFileSync(file, 'utf8'));

  // Each dimension's decade data is read once per load; prose tokens and chart panels share it.
  const cache = new Map();
  const shares = (dimension) => {
    if (!cache.has(dimension)) cache.set(dimension, decadeShares(db, dimension));
    return cache.get(dimension);
  };

  const tokenDims = new Set();
  for (const b of blocks) {
    if (b.type !== 'prose') continue;
    for (const t of findTokens(b.markdown)) if ((t.name === 'pct' || t.name === 'n') && t.args[0]) tokenDims.add(t.args[0]);
  }
  const loaded = {};
  for (const d of tokenDims) loaded[d] = await shares(d);
  const resolve = (name, args) => {
    if (name === 'pct' && args.length === 3) return pct(loaded[args[0]], args[1], args[2]);
    if (name === 'n' && args.length === 2) return nOf(loaded[args[0]], args[1]);
    throw new StoryError('BAD_TOKEN', `Unknown or malformed token "${name}"`);
  };

  const out = [];
  for (const b of blocks) {
    if (b.type === 'prose') { out.push({ type: 'prose', markdown: applyTokens(b.markdown, resolve) }); continue; }
    const { kind, args } = b;
    if (kind === 'opening') {
      const cards = await songCards(db, csv(args.songs).map((id) => ({ id: Number(id), caption: '' })));
      out.push({ type: 'opening', title: meta.title, subtitle: meta.subtitle, art: cards.map((c) => c.art).filter(Boolean) });
    } else if (kind === 'songs') {
      out.push({ type: 'songs', songs: await songCards(db, b.rows) });
    } else if (kind === 'closing') {
      out.push({ type: 'closing', label: args.label || 'Explore these songs', href: browseHref(args.browse) });
    } else if (kind === 'chart' && (b.variant === 'decade-bars' || b.variant === 'decade-lines')) {
      const dim = dimensionOf(args.dimension);
      const result = await shares(args.dimension);
      const codes = cleanCodes(dim, args.dimension, args.codes);
      const labelOf = (c) => dim.label(c);
      if (b.variant === 'decade-bars') {
        const decade = Number(args.decade);
        const here = result.decades.find((d) => d.decade === decade);
        if (!here || !here.plot) throw new StoryError('BAD_BLOCK', `The ${args.decade}s have too few songs for ${args.dimension}`);
        const prev = result.decades.find((d) => d.decade === decade - 10 && d.plot) || null;
        out.push({
          type: 'chart', variant: 'decade-bars', dimension: args.dimension, decade,
          previousDecade: prev ? prev.decade : null,
          bars: codes.map((code) => ({ code, label: labelOf(code), share: here.shares[code] || 0, previousShare: prev ? (prev.shares[code] || 0) : null })),
          n: here.n, previousN: prev ? prev.n : null,
          caption: captionFor(args.dimension, here.n, `from the ${decade}s`),
        });
      } else {
        out.push({
          type: 'chart', variant: 'decade-lines', dimension: args.dimension,
          decades: result.decades.map(({ decade, n, plot }) => ({ decade, n, plot })),
          series: codes.map((code) => ({
            code, label: labelOf(code),
            values: result.decades.map((d) => (d.plot ? (d.shares[code] || 0) : null)),
          })),
          caption: captionFor(args.dimension, result.decades.reduce((a, d) => a + d.n, 0), `with a release year; decades with fewer than ${MIN_POINT_N} songs are not plotted`),
        });
      }
    } else {
      throw new StoryError('BAD_BLOCK', `Unsupported block @${kind}${b.variant ? ` ${b.variant}` : ''}`);
    }
  }
  return { slug, title: meta.title, subtitle: meta.subtitle, blocks: out };
}

// The Stories index: one entry per story, cover = album art of the first song of its opening. A broken story is
// logged and left out so one bad edit cannot hide the others (the shipped-stories test catches it before then).
async function listStories(db, dir = DEFAULT_DIR) {
  const list = [];
  for (const [slug, file] of storyFiles(dir)) {
    try {
      const { meta, blocks } = parseStory(fs.readFileSync(file, 'utf8'));
      const opening = blocks.find((b) => b.type === 'panel' && b.kind === 'opening');
      const first = opening && csv(opening.args.songs)[0];
      const cover = first ? (await songCards(db, [{ id: Number(first), caption: '' }]))[0].art : null;
      list.push({ slug, title: meta.title, subtitle: meta.subtitle, order: meta.order, cover });
    } catch (err) {
      console.error('story skipped:', slug, err.code || '', err.message);
    }
  }
  return list.sort((a, b) => a.order - b.order || (a.slug < b.slug ? -1 : 1));
}

module.exports = {
  StoryError, parseStory, findTokens, applyTokens,
  MIN_POINT_N, DIMENSIONS, decadeShares, pct, nOf, songCards, loadStory, listStories,
};
