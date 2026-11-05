// Thread claims: unconfirmed "is this person vegan" notes from a pasted Reddit thread. Admin-only text kept in
// `thread_claims` on artists and leads, one dated line per claim, appended and never replaced.
const STATUS_LABELS = {
  vegan: 'vegan', vegetarian: 'vegetarian', formerly_vegan: 'formerly vegan', not_vegan: 'not vegan', unsure: 'unsure',
};
const QUOTE_MAX = 200;
const PREFIX = /^Reddit \d{4}-\d{2}-\d{2} · /;

// The curator's own calendar day (toISOString would be the UTC day, which can be yesterday or tomorrow here).
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function claimLine({ url, person, status, quote, dispute }, now = new Date()) {
  const q = String(quote || '').replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX).trim();
  const who = String(person || '').replace(/\s+/g, ' ').trim() || 'whole band';
  const d = String(dispute || '').replace(/\s+/g, ' ').trim();
  return `Reddit ${localDate(now)} · ${url} · ${who}: ${STATUS_LABELS[status] || status}`
    + (q ? ` - "${q}"` : '') + (d ? ` · disputed: ${d}` : '');
}

const bodyOf = (line) => String(line).trim().replace(PREFIX, '');

// Append the lines that are not already there (compared without their date). `table` is whitelisted, never interpolated from input.
async function appendClaimLines(db, table, id, lines) {
  if (table !== 'artists' && table !== 'leads') throw new Error('appendClaimLines: unsupported table');
  const wanted = [];
  const seen = new Set();
  const row = (await db.query(`SELECT thread_claims FROM ${table} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!row) return 0;
  for (const l of String(row.thread_claims || '').split('\n')) seen.add(bodyOf(l));
  for (const line of lines) {
    const body = bodyOf(line);
    if (!body || seen.has(body)) continue;
    seen.add(body);
    wanted.push(String(line).trim());
  }
  if (!wanted.length) return 0;
  const current = row.thread_claims || '';
  const next = current ? `${current}\n${wanted.join('\n')}` : wanted.join('\n');
  await db.query(`UPDATE ${table} SET thread_claims = $2${table === 'artists' ? ', updated_at = CURRENT_TIMESTAMP' : ''} WHERE id = $1`, [id, next]);
  return wanted.length;
}

module.exports = { STATUS_LABELS, claimLine, bodyOf, appendClaimLines };
