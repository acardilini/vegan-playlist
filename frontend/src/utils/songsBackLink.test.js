import test from 'node:test';
import assert from 'node:assert/strict';
import { songsBackLink } from './songsBackLink.js';

test('back goes to the rail the song was opened from', () => {
  assert.equal(songsBackLink({ from: 'check-transcripts', ids: [1], index: 0 }), '/admin/songs?queue=check-transcripts');
  assert.equal(songsBackLink({ from: 'needs-lyrics' }), '/admin/songs?queue=needs-lyrics');
});

test('with no state, or an odd from, back goes to the plain Songs page', () => {
  assert.equal(songsBackLink(null), '/admin/songs');
  assert.equal(songsBackLink(undefined), '/admin/songs');
  assert.equal(songsBackLink({}), '/admin/songs');
  assert.equal(songsBackLink({ from: '' }), '/admin/songs');
  assert.equal(songsBackLink({ from: 42 }), '/admin/songs');
});

test('the queue name is encoded, so it cannot add parameters', () => {
  assert.equal(songsBackLink({ from: 'a&b=c' }), '/admin/songs?queue=a%26b%3Dc');
});
