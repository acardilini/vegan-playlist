import test from 'node:test';
import assert from 'node:assert/strict';
import { audioSourceVideo, listenUrl } from './videoSource.js';

const v = (id, extra = {}) => ({ id, youtube_id: `abcdefghi${String(id).padStart(2, '0')}`, ...extra });

test('the video marked as the audio source wins over the primary', () => {
  const vids = [v(1, { is_primary: true }), v(2, { is_audio_source: true })];
  assert.equal(audioSourceVideo(vids).id, 2);
});

test('with no mark the primary is used; with no primary either, the first video', () => {
  assert.equal(audioSourceVideo([v(1), v(2, { is_primary: true })]).id, 2);
  assert.equal(audioSourceVideo([v(3), v(4)]).id, 3);
});

test('no videos, or not an array, gives null', () => {
  assert.equal(audioSourceVideo([]), null);
  assert.equal(audioSourceVideo(undefined), null);
  assert.equal(audioSourceVideo(null), null);
});

test('listenUrl is the watch page of the chosen video, and null without a usable one', () => {
  assert.equal(listenUrl([v(1, { is_primary: true })]), 'https://www.youtube.com/watch?v=abcdefghi01');
  assert.equal(listenUrl([]), null);
  assert.equal(listenUrl([{ id: 1, youtube_id: 'short', is_primary: true }]), null);
  assert.equal(listenUrl([{ id: 1, youtube_id: 'abc"><script>', is_primary: true }]), null);
});
