const { test } = require('node:test');
const assert = require('node:assert');
const { parseStory, findTokens, applyTokens, StoryError } = require('../services/stories');

// Pure parser tests: no database. Sentinel not needed.

const FM = '---\ntitle: From shouts\nsubtitle: How voices changed\norder: 3\n---\n';

test('front matter gives title, subtitle and numeric order; order defaults to 100', () => {
  const s = parseStory(`${FM}Hello.`);
  assert.deepEqual(s.meta, { title: 'From shouts', subtitle: 'How voices changed', order: 3 });
  assert.equal(parseStory('---\ntitle: T\n---\nx').meta.order, 100);
});

test('a story with no title or no front matter is BAD_FORMAT', () => {
  assert.throws(() => parseStory('---\nsubtitle: x\n---\nbody'), e => e instanceof StoryError && e.code === 'BAD_FORMAT');
  assert.throws(() => parseStory('just prose'), e => e.code === 'BAD_FORMAT');
});

test('prose and panels alternate in file order and empty prose is dropped', () => {
  const s = parseStory(`${FM}@opening songs=1,2\n\nFirst paragraph.\n\nSecond.\n@chart decade-bars dimension=vocal_style codes=A,B decade=1980\nAfter chart.\n@closing browse=vocal_style:A label="Explore them"\n`);
  assert.deepEqual(s.blocks.map(b => b.type + ':' + (b.kind || '')), [
    'panel:opening', 'prose:', 'panel:chart', 'prose:', 'panel:closing',
  ]);
  assert.equal(s.blocks[1].markdown, 'First paragraph.\n\nSecond.');
});

test('chart blocks carry a variant and string args; quoted values keep their spaces', () => {
  const s = parseStory(`${FM}@chart decade-bars dimension=vocal_style codes=A,B decade=1980\n@closing label="Explore the growled songs" browse=vocal_style:A`);
  const chart = s.blocks[0];
  assert.equal(chart.variant, 'decade-bars');
  assert.deepEqual(chart.args, { dimension: 'vocal_style', codes: 'A,B', decade: '1980' });
  assert.equal(s.blocks[1].args.label, 'Explore the growled songs');
});

test('songs rows parse id | caption and end at the first prose line', () => {
  const s = parseStory(`${FM}@songs\n152 | Where it started.\n\n1376 | Fast and loud | really.\nThen some prose.`);
  assert.deepEqual(s.blocks[0].rows, [
    { id: 152, caption: 'Where it started.' },
    { id: 1376, caption: 'Fast and loud | really.' },
  ]);
  assert.equal(s.blocks[1].type, 'prose');
  assert.equal(s.blocks[1].markdown, 'Then some prose.');
});

test('an unknown @kind is BAD_BLOCK', () => {
  assert.throws(() => parseStory(`${FM}@video id=1`), e => e.code === 'BAD_BLOCK');
});

test('CRLF input parses the same as LF', () => {
  const lf = `${FM}Text.\n@songs\n5 | cap\n`;
  assert.deepEqual(parseStory(lf.replace(/\n/g, '\r\n')), parseStory(lf));
});

test('findTokens reads name and args; a lone {{ is left alone', () => {
  assert.deepEqual(findTokens('a {{pct vocal_style A 1980}} b').map(t => [t.name, t.args]), [['pct', ['vocal_style', 'A', '1980']]]);
  assert.deepEqual(findTokens('open {{ never closed'), []);
});

test('applyTokens splices the resolver result; a throwing resolver is BAD_TOKEN', () => {
  const calls = [];
  const out = applyTokens('x {{pct vocal_style A 1980}} y', (name, args) => { calls.push([name, args]); return '46%'; });
  assert.equal(out, 'x 46% y');
  assert.deepEqual(calls, [['pct', ['vocal_style', 'A', '1980']]]);
  assert.throws(() => applyTokens('{{nope}}', () => { throw new Error('boom'); }), e => e instanceof StoryError && e.code === 'BAD_TOKEN');
  const keep = new StoryError('BAD_TOKEN', 'x');
  assert.throws(() => applyTokens('{{n a 1}}', () => { throw keep; }), e => e === keep);
});
