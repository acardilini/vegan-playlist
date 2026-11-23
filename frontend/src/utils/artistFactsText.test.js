import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryLine, memberList } from './artistFactsText.js';

test('summaryLine joins every part that exists, with the release range', () => {
  assert.equal(summaryLine({ country: 'Germany', formed_year: 2009, first_release_year: 1996, last_release_year: 2024 }), 'Germany · Formed 2009 · Released 1996–2024');
});
test('summaryLine: equal years print one year, a single known year says which', () => {
  assert.equal(summaryLine({ first_release_year: 1999, last_release_year: 1999 }), 'Released 1999');
  assert.equal(summaryLine({ last_release_year: 2024 }), 'Last release 2024');
  assert.equal(summaryLine({ first_release_year: 1996 }), 'First release 1996');
});
test('summaryLine never prints a backwards range', () => {
  assert.equal(summaryLine({ first_release_year: 2030, last_release_year: 2010 }), 'Last release 2010');
});
test('summaryLine skips missing parts without stray separators', () => {
  assert.equal(summaryLine({ country: 'Germany' }), 'Germany');
  assert.equal(summaryLine({ formed_year: 2009 }), 'Formed 2009');
  assert.equal(summaryLine({ country: 'Germany', last_release_year: 2020 }), 'Germany · Last release 2020');
  assert.equal(summaryLine({ formed_year: 2009, first_release_year: 2010, last_release_year: 2012 }), 'Formed 2009 · Released 2010–2012');
});
test('summaryLine is null with nothing to show', () => {
  for (const f of [null, undefined, {}, { members: [{ name: 'A', is_current: true, vegan: false }] }]) assert.equal(summaryLine(f), null);
});
test('summaryLine never prints undefined or null', () => {
  assert.ok(!/undefined|null/.test(summaryLine({ country: 'X', formed_year: undefined, first_release_year: null, last_release_year: null })));
});
test('memberList is current first and empty when there are none', () => {
  assert.deepEqual(memberList(null), []);
  assert.deepEqual(memberList({}), []);
  assert.deepEqual(memberList({ members: [{ name: 'Old', is_current: false, vegan: true }, { name: 'New', is_current: true, vegan: false }] }),
    [{ name: 'New', vegan: false, former: false }, { name: 'Old', vegan: true, former: true }]);
});
