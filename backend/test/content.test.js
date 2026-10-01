const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

// No DB and no fixtures — this router only reads two files off disk.

async function withServer(fn) {
  const app = express();
  app.use('/api/content', require('../routes/content'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(r => server.close(r));
  }
}

test('each whitelisted page serves its markdown', async () => {
  await withServer(async (base) => {
    for (const slug of ['about', 'analysis']) {
      const res = await fetch(`${base}/api/content/${slug}`);
      assert.equal(res.status, 200, `${slug} is served`);
      const body = await res.json();
      assert.equal(body.slug, slug);
      assert.ok(body.markdown.length > 200, `${slug} has real content`);
      assert.ok(body.markdown.includes('##'), `${slug} is markdown with headings`);
    }
  });
});

test('an unknown page 404s', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/content/nope`);
    assert.equal(res.status, 404);
  });
});

test('a traversal slug reads nothing', async () => {
  await withServer(async (base) => {
    for (const slug of ['..%2F..%2F.env', '%2Fetc%2Fpasswd', 'about.md']) {
      const res = await fetch(`${base}/api/content/${slug}`);
      assert.equal(res.status, 404, `${slug} must not resolve`);
    }
  });
});

test('an inherited Object property is not a page', async () => {
  // A plain-object lookup would return Object's constructor here — truthy, and then used as
  // a filename. The whitelist must be a Map (or a hasOwnProperty check) for this to 404.
  await withServer(async (base) => {
    for (const slug of ['constructor', 'toString', '__proto__']) {
      const res = await fetch(`${base}/api/content/${slug}`);
      assert.equal(res.status, 404, `${slug} must not resolve`);
    }
  });
});
