import test from 'node:test';
import assert from 'node:assert/strict';
import { memberKey, FACT_FIELDS, sourceKeyFor, factRows, memberRows, canAcceptAll, basicsStatus } from './basicsModel.js';

const facts = (o = {}) => ({
  country: null, country_source: null, formed_year: null, formed_source: null, disbanded_year: null, disbanded_source: null,
  first_release_year: null, first_release_source: null, last_release_year: null, last_release_source: null, members: [], ...o,
});
const fieldRow = (field, o = {}) => ({ field, label: field, current: null, proposed: 'x', source: 'MusicBrainz', confidence: 'HIGH', link: 'https://mb.example', locked: false, ...o });
const memRow = (name, o = {}) => ({ name, is_current: true, source: 'MusicBrainz', change: 'new', existing: null, locked: false, ...o });
const review = (o = {}) => ({ has_proposal: true, match: { state: 'approved' }, fields: [], members: [], warnings: [], vegan_hints: [], ...o });
const none = new Set();

test('memberKey folds case, diacritics and spacing like the server', () => {
  assert.equal(memberKey('José  Pérez'), 'jose perez');
  assert.equal(memberKey('  ANN '), 'ann');
  assert.equal(memberKey(null), '');
});

test('FACT_FIELDS and sourceKeyFor name the five facts and their source columns', () => {
  assert.deepEqual(FACT_FIELDS.map((f) => f.key), ['country', 'formed_year', 'disbanded_year', 'first_release_year', 'last_release_year']);
  assert.deepEqual(FACT_FIELDS.map((f) => sourceKeyFor(f.key)), ['country_source', 'formed_source', 'disbanded_source', 'first_release_source', 'last_release_source']);
  assert.equal(FACT_FIELDS.find((f) => f.key === 'country').year, false);
  assert.equal(FACT_FIELDS.find((f) => f.key === 'formed_year').year, true);
});

test('factRows: the five facts in order with stored value and source, no proposal without a review', () => {
  const rows = factRows(facts({ country: 'Germany', country_source: 'MusicBrainz', formed_year: 1999, formed_source: 'Added by curator' }), null, none);
  assert.deepEqual(rows.map((r) => r.key), ['country', 'formed_year', 'disbanded_year', 'first_release_year', 'last_release_year']);
  assert.deepEqual([rows[0].value, rows[0].source, rows[1].value, rows[2].value, rows[2].source], ['Germany', 'MusicBrainz', '1999', '', null]);
  assert.ok(rows.every((r) => r.proposal === null && r.warnings.length === 0 && r.readOnly === false));
});

test('factRows: a proposal is attached, a skipped one is hidden, warnings are routed by field', () => {
  const rv = review({
    fields: [fieldRow('country', { proposed: 'Sweden', current: 'Norway' }), fieldRow('formed_year', { proposed: 1990 })],
    warnings: [{ field: 'formed_year', text: 'Formed after the earliest album' }, { field: 'match', text: 'other' }],
  });
  const rows = factRows(facts({ country: 'Norway' }), rv, new Set(['field:formed_year']));
  assert.deepEqual([rows[0].proposal.proposed, rows[0].proposal.field, rows[0].proposal.locked], ['Sweden', 'country', false]);
  assert.equal(rows[1].proposal, null);
  assert.deepEqual(rows[1].warnings, ['Formed after the earliest album']);
  assert.deepEqual(rows[0].warnings, []);
});

test('factRows: a Bandcamp link proposal is an extra read-only row, only while proposed and not skipped', () => {
  const rv = review({ fields: [fieldRow('bandcamp_url', { proposed: 'https://x.bandcamp.com', current: null, source: 'Bandcamp' })] });
  const rows = factRows(facts(), rv, none);
  assert.equal(rows.length, 6);
  assert.deepEqual([rows[5].key, rows[5].label, rows[5].readOnly, rows[5].proposal.proposed], ['bandcamp_url', 'Bandcamp link', true, 'https://x.bandcamp.com']);
  assert.equal(factRows(facts(), rv, new Set(['field:bandcamp_url'])).length, 5);
  assert.equal(factRows(facts(), review(), none).length, 5);
});

test('memberRows: hints match by name key, a status change attaches to the stored member, new members are proposed', () => {
  const f = facts({ members: [{ id: 1, name: 'José', role: null, is_current: true, vegan: false, source: 'Added by curator' }, { id: 2, name: 'Bob', role: 'Bass', is_current: true, vegan: true, source: 'MusicBrainz' }] });
  const rv = review({
    members: [memRow('jose', { change: 'status', is_current: false, existing: { id: 1 } }), memRow('Newbie')],
    vegan_hints: [{ name: 'JOSE', url: 'https://x.example/j', confidence: 'HIGH' }],
  });
  const { stored, proposed } = memberRows(f, rv, none);
  assert.deepEqual(stored.map((m) => m.name), ['José', 'Bob']);
  assert.deepEqual(stored[0].hint, { url: 'https://x.example/j', confidence: 'HIGH' });
  assert.equal(stored[1].hint, null);
  assert.deepEqual([stored[0].change.kind, stored[0].change.is_current, stored[0].change.name], ['status', false, 'jose']);
  assert.equal(stored[1].change, null);
  assert.deepEqual(proposed.map((m) => m.name), ['Newbie']);
});

test('memberRows: skipped members disappear, and no review leaves stored rows alone', () => {
  const f = facts({ members: [{ id: 1, name: 'Ann', role: null, is_current: true, vegan: false, source: 'x' }] });
  const rv = review({ members: [memRow('Ann', { change: 'status', is_current: false }), memRow('Newbie')] });
  const r = memberRows(f, rv, new Set(['member:Ann', 'member:Newbie']));
  assert.equal(r.stored[0].change, null);
  assert.deepEqual(r.proposed, []);
  const bare = memberRows(f, null, none);
  assert.deepEqual([bare.stored.length, bare.stored[0].hint, bare.stored[0].change, bare.proposed], [1, null, null, []]);
});

test('canAcceptAll: fill-only rule', () => {
  const ok = review({ fields: [fieldRow('country')] });
  assert.equal(canAcceptAll(ok, none), true);
  assert.equal(canAcceptAll(null, none), false);
  assert.equal(canAcceptAll({ has_proposal: false }, none), false);
  assert.equal(canAcceptAll(ok, new Set(['field:formed_year'])), false); // anything skipped
  assert.equal(canAcceptAll(review({ fields: [fieldRow('country', { locked: true })] }), none), false);
  assert.equal(canAcceptAll(review({ fields: [fieldRow('country', { current: 'Norway' })] }), none), false); // would replace
  assert.equal(canAcceptAll(review({ fields: [fieldRow('country')], warnings: [{ field: 'country', text: 'w' }] }), none), false);
  const bc = { fields: [fieldRow('bandcamp_url', { source: 'Bandcamp' })] };
  assert.equal(canAcceptAll(review({ ...bc, match: { state: 'needs-approval' } }), none), false);
  assert.equal(canAcceptAll(review({ ...bc, match: { state: 'pretrusted' } }), none), true);
  assert.equal(canAcceptAll(review({ members: [memRow('Newbie')] }), none), true);
  assert.equal(canAcceptAll(review({ members: [memRow('Newbie')], warnings: [{ field: 'members', text: 'w' }] }), none), false);
  assert.equal(canAcceptAll(review({ members: [memRow('Ann', { change: 'status', existing: { id: 1 } })] }), none), false); // never changes a stored member
});

test('basicsStatus: rows to review, not started, done', () => {
  const stored = facts({ country: 'Germany' });
  assert.deepEqual(basicsStatus(stored, review({ fields: [fieldRow('country', { current: 'x' }), fieldRow('formed_year')], members: [memRow('N')] }), none), { label: '3 to review', tone: 'todo' });
  assert.deepEqual(basicsStatus(stored, review({ fields: [fieldRow('formed_year')] }), new Set(['field:formed_year'])), { label: 'done', tone: 'ok' });
  assert.deepEqual(basicsStatus(facts(), null, none), { label: 'not started', tone: 'todo' });
  assert.deepEqual(basicsStatus(facts(), { has_proposal: false, finished_at: null }, none), { label: 'not started', tone: 'todo' });
  assert.deepEqual(basicsStatus(stored, { has_proposal: false, finished_at: null }, none), { label: 'done', tone: 'ok' });
  assert.deepEqual(basicsStatus(facts({ members: [{ id: 1, name: 'A' }] }), null, none), { label: 'done', tone: 'ok' });
  assert.deepEqual(basicsStatus(null, null, none), { label: 'not started', tone: 'todo' });
});
