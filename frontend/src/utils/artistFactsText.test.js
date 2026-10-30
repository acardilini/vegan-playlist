import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryLine, memberList } from './artistFactsText.js';

test('summaryLine joins every part that exists', () => {
  assert.equal(summaryLine({ country: 'Germany', formed_year: 2009, active_label: 'Active, last release 2024' }), 'Germany · Formed 2009 · Active, last release 2024');
});
test('summaryLine skips missing parts without stray separators', () => {
  assert.equal(summaryLine({ country: 'Germany' }), 'Germany');
  assert.equal(summaryLine({ formed_year: 2009 }), 'Formed 2009');
  assert.equal(summaryLine({ active_label: 'Inactive, last release 2012' }), 'Inactive, last release 2012');
  assert.equal(summaryLine({ country: 'Germany', active_label: 'Active' }), 'Germany · Active');
  assert.equal(summaryLine({ formed_year: 2009, active_label: 'Active' }), 'Formed 2009 · Active');
});
test('summaryLine is null with nothing to show', () => {
  for (const f of [null, undefined, {}, { members: [{ name: 'A', is_current: true, vegan: false }] }]) assert.equal(summaryLine(f), null);
});
test('summaryLine never prints undefined or null', () => {
  assert.ok(!/undefined|null/.test(summaryLine({ country: 'X', formed_year: undefined, active_label: null })));
});
test('memberList is current first and empty when there are none', () => {
  assert.deepEqual(memberList(null), []);
  assert.deepEqual(memberList({}), []);
  assert.deepEqual(memberList({ members: [{ name: 'Old', is_current: false, vegan: true }, { name: 'New', is_current: true, vegan: false }] }),
    [{ name: 'New', vegan: false, former: false }, { name: 'Old', vegan: true, former: true }]);
});
