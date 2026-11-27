// Pure model for the artist page's Basics section: the fact rows, the member rows, the fill-only Accept all rule and the
// section's status. No DOM here, so node --test covers it. Lookups go through Map so a data-supplied name can never reach an
// inherited property.
export const FACT_FIELDS = [
  { key: 'country', label: 'Country', year: false },
  { key: 'formed_year', label: 'Formed', year: true },
  { key: 'disbanded_year', label: 'Disbanded', year: true },
  { key: 'first_release_year', label: 'First release', year: true },
  { key: 'last_release_year', label: 'Last release', year: true },
];

const SOURCE_KEYS = new Map([
  ['country', 'country_source'], ['formed_year', 'formed_source'], ['disbanded_year', 'disbanded_source'],
  ['first_release_year', 'first_release_source'], ['last_release_year', 'last_release_source'],
]);
export const sourceKeyFor = (key) => SOURCE_KEYS.get(key) || null;

const MATCH_TRUSTED = new Set(['approved', 'pretrusted']);
const isEmpty = (v) => v === null || v === undefined || v === '';

// The same rule as the server's artistFacts.nameKey: case, diacritics and spacing folded.
export function memberKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const hasProposal = (review) => !!(review && review.has_proposal);
const warningsFor = (review, field) => (hasProposal(review) ? review.warnings || [] : []).filter((w) => w.field === field).map((w) => w.text);

// One row per fact (the stored value and its source) plus the review's proposal for it unless the curator skipped it. A
// proposed Bandcamp link is an extra read-only row: the link itself is edited in section 1.
export function factRows(facts, review, skipped) {
  const f = facts || {};
  const byField = new Map((hasProposal(review) ? review.fields || [] : []).map((r) => [r.field, r]));
  const proposalOf = (key) => {
    const r = byField.get(key);
    if (!r || skipped.has(`field:${key}`)) return null;
    return { field: key, proposed: r.proposed, source: r.source, confidence: r.confidence || null, link: r.link || null, locked: !!r.locked };
  };
  const rows = FACT_FIELDS.map(({ key, label, year }) => ({
    key, label, year, readOnly: false,
    value: isEmpty(f[key]) ? '' : String(f[key]),
    source: f[sourceKeyFor(key)] || null,
    proposal: proposalOf(key),
    warnings: warningsFor(review, key),
  }));
  const bc = proposalOf('bandcamp_url');
  if (bc) {
    const cur = byField.get('bandcamp_url').current;
    rows.push({ key: 'bandcamp_url', label: 'Bandcamp link', year: false, readOnly: true, value: isEmpty(cur) ? '' : String(cur), source: null, proposal: bc, warnings: warningsFor(review, 'bandcamp_url') });
  }
  return rows;
}

// Stored members, each with its evidence hint (a link only) and any proposed status change, and the members the review
// proposes that are not stored yet. Skipped proposals are gone.
export function memberRows(facts, review, skipped) {
  const stored = (facts && facts.members) || [];
  const proposals = hasProposal(review) ? review.members || [] : [];
  const hints = new Map((hasProposal(review) ? review.vegan_hints || [] : []).map((h) => [memberKey(h.name), h]));
  const live = proposals.filter((m) => !skipped.has(`member:${m.name}`));
  const changes = new Map(live.filter((m) => m.change !== 'new').map((m) => [memberKey(m.name), m]));
  return {
    stored: stored.map((m) => {
      const key = memberKey(m.name);
      const h = hints.get(key);
      const c = changes.get(key);
      return {
        ...m,
        hint: h ? { url: h.url, confidence: h.confidence || null } : null,
        change: c ? { kind: c.change, is_current: c.is_current, source: c.source, locked: !!c.locked, name: c.name } : null,
      };
    }),
    proposed: live.filter((m) => m.change === 'new').map((m) => ({ name: m.name, is_current: m.is_current, source: m.source, locked: !!m.locked })),
  };
}

// Accept all shown is FILL-ONLY: it needs an unlocked row with no warning of its own and an empty stored value (the Bandcamp
// link only once the match is approved or pre-trusted), or a new member. The server takes no row list and would also apply a
// row hidden with Skip, so once anything is skipped it is not offered.
export function canAcceptAll(review, skipped) {
  if (!hasProposal(review) || skipped.size > 0) return false;
  const warned = (field) => (review.warnings || []).some((w) => w.field === field);
  const trusted = MATCH_TRUSTED.has(review.match && review.match.state);
  return (review.fields || []).some((f) => !f.locked && !warned(f.field) && isEmpty(f.current) && (f.field !== 'bandcamp_url' || trusted))
    || (review.members || []).some((m) => !m.locked && m.change === 'new' && !warned('members'));
}

// The section pill: proposed rows still waiting, else whether anything has been entered at all.
export function basicsStatus(facts, review, skipped) {
  let pending = 0;
  if (hasProposal(review)) {
    pending = (review.fields || []).filter((f) => !skipped.has(`field:${f.field}`)).length
      + (review.members || []).filter((m) => !skipped.has(`member:${m.name}`)).length;
  }
  if (pending > 0) return { label: `${pending} to review`, tone: 'todo' };
  const f = facts || {};
  const entered = FACT_FIELDS.some(({ key }) => !isEmpty(f[key])) || (f.members || []).length > 0;
  return entered ? { label: 'done', tone: 'ok' } : { label: 'not started', tone: 'todo' };
}
