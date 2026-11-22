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

module.exports = { StoryError, parseStory, findTokens, applyTokens };
