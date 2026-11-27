import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tabFromSearch, searchWithTab, mergeWithFromSearch, searchWithoutMergeWith, bannerItems, identityStatus,
} from './workbenchView.js';

test('tabFromSearch: only ?tab=catalogue selects the catalogue tab', () => {
  assert.equal(tabFromSearch(''), 'details');
  assert.equal(tabFromSearch(undefined), 'details');
  assert.equal(tabFromSearch('?tab=catalogue'), 'catalogue');
  assert.equal(tabFromSearch('?x=1&tab=catalogue'), 'catalogue');
  assert.equal(tabFromSearch('?tab=details'), 'details');
  assert.equal(tabFromSearch('?tab=constructor'), 'details');
  assert.equal(tabFromSearch('?tab=CATALOGUE'), 'details');
});

test('searchWithTab sets or removes tab and keeps other params', () => {
  assert.equal(searchWithTab('', 'catalogue'), '?tab=catalogue');
  assert.equal(searchWithTab('?tab=catalogue', 'details'), '');
  assert.equal(searchWithTab('?mergeWith=7', 'catalogue'), '?mergeWith=7&tab=catalogue');
  assert.equal(searchWithTab('?mergeWith=7&tab=catalogue', 'details'), '?mergeWith=7');
  assert.equal(searchWithTab('', 'details'), '');
  assert.equal(searchWithTab('', 'constructor'), '');
  assert.equal(tabFromSearch(searchWithTab('?mergeWith=7', 'catalogue')), 'catalogue');
});

test('mergeWithFromSearch accepts only a positive safe integer other than the artist itself', () => {
  assert.equal(mergeWithFromSearch('?mergeWith=7', 3), 7);
  assert.equal(mergeWithFromSearch('?mergeWith=3', 3), null);
  assert.equal(mergeWithFromSearch('?mergeWith=abc', 3), null);
  assert.equal(mergeWithFromSearch('?mergeWith=-2', 3), null);
  assert.equal(mergeWithFromSearch('?mergeWith=0', 3), null);
  assert.equal(mergeWithFromSearch('?mergeWith=7.5', 3), null);
  assert.equal(mergeWithFromSearch('?mergeWith=99999999999999999999', 3), null);
  assert.equal(mergeWithFromSearch('', 3), null);
  assert.equal(mergeWithFromSearch(undefined, 3), null);
});

test('searchWithoutMergeWith removes only mergeWith', () => {
  assert.equal(searchWithoutMergeWith('?mergeWith=7'), '');
  assert.equal(searchWithoutMergeWith('?mergeWith=7&tab=catalogue'), '?tab=catalogue');
  assert.equal(searchWithoutMergeWith('?tab=catalogue'), '?tab=catalogue');
  assert.equal(searchWithoutMergeWith(''), '');
});

const review = (match) => ({ has_proposal: true, match: { state: 'approved', shared_with: [], wrong_identity: false, ...match } });

test('bannerItems: nothing without a proposal or without a problem', () => {
  assert.deepEqual(bannerItems(null), []);
  assert.deepEqual(bannerItems(undefined), []);
  assert.deepEqual(bannerItems({ has_proposal: false, finished_at: null }), []);
  assert.deepEqual(bannerItems(review({})), []);
});

test('bannerItems: one shared item per partner, then the wrong-identity item', () => {
  const items = bannerItems(review({
    shared_with: [{ id: 4, name: 'Earth Crisis (2)', songs: 1 }, { id: 9, name: 'Other', songs: 3 }],
    wrong_identity: true,
  }));
  assert.deepEqual(items.map((i) => i.key), ['shared:4', 'shared:9', 'wrong']);
  assert.deepEqual(items[0], {
    key: 'shared:4', kind: 'shared', otherId: 4, actionLabel: 'Review merge',
    text: 'Another artist uses the same MusicBrainz id: Earth Crisis (2) (1 song)',
  });
  assert.equal(items[1].text, 'Another artist uses the same MusicBrainz id: Other (3 songs)');
  assert.deepEqual(items[2], {
    key: 'wrong', kind: 'wrong', actionLabel: 'Check match',
    text: 'A later check found this MusicBrainz id belongs to a different act',
  });
});

test('identityStatus counts unset ids and a match still waiting for a decision', () => {
  const all = { spotify: 'a', bandcamp: 'b', musicbrainz: 'c' };
  assert.deepEqual(identityStatus(all, review({ state: 'approved' })), { label: 'done', tone: 'ok' });
  assert.deepEqual(identityStatus({ ...all, bandcamp: null }, review({ state: 'approved' })), { label: '1 to check', tone: 'todo' });
  assert.deepEqual(identityStatus({ ...all, bandcamp: null }, review({ state: 'needs-approval' })), { label: '2 to check', tone: 'todo' });
  assert.deepEqual(identityStatus(all, review({ state: 'pretrusted' })), { label: '1 to check', tone: 'todo' });
  assert.deepEqual(identityStatus({ spotify: null, bandcamp: null, musicbrainz: 'c' }, null), { label: '2 to check', tone: 'todo' });
  assert.deepEqual(identityStatus(all, { has_proposal: false, finished_at: null }), { label: 'done', tone: 'ok' });
});
