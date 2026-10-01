// Substitute {{token}} placeholders in curator-authored Markdown. Pure: no DOM, no React,
// so `node --test` exercises it directly.
//
// An unknown token is left EXACTLY as written rather than replaced with an empty string, so
// a typo in the .md file shows up on the page instead of silently vanishing.

// One capture group, so String.split() interleaves the code chunks at odd indices.
const CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;
const TOKEN_RE = /\{\{(\w+)\}\}/g;

export function substituteTokens(markdown, values) {
  if (!markdown) return '';
  const vals = values || {};
  return markdown
    .split(CODE_RE)
    .map((chunk, i) => (
      // Odd indices are the captured code spans/blocks — the .md file documents its own
      // token names inside backticks, so those must survive verbatim.
      i % 2 === 1
        ? chunk
        : chunk.replace(TOKEN_RE, (whole, name) =>
          (Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : whole))
    ))
    .join('');
}

// Explicit locale so the grouping separator is deterministic in tests and identical for
// every visitor, rather than following whatever the browser happens to be set to.
const LOCALE = 'en-GB';
const MISSING = '—';

const num = (n) => (Number.isFinite(n) ? n.toLocaleString(LOCALE) : MISSING);

// "a", "a and b", "a, b and c" — the disclosure line reads as a sentence.
function list(names) {
  if (names.length === 0) return MISSING;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function tokenValues(coverage) {
  const c = coverage || {};
  const models = Array.isArray(c.latest_pass_models) ? c.latest_pass_models : [];
  const pct = (Number.isFinite(c.analysed_songs) && c.live_songs)
    ? `${Math.round((c.analysed_songs / c.live_songs) * 100)}%`
    : MISSING;
  const when = c.latest_pass_at ? new Date(c.latest_pass_at) : null;

  return {
    songs: num(c.live_songs),
    artists: num(c.artists),
    analysed: num(c.analysed_songs),
    analysedPct: pct,
    mapped: num(c.mapped_songs),
    codingModels: list(models.map(m => m.model)),
    codingDate: (when && !Number.isNaN(when.getTime()))
      ? when.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })
      : MISSING,
  };
}
