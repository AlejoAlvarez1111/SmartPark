const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {} };

async function withApp(db, fn) {
  const srv = createApp({ db, logger: silent }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${srv.address().port}`);
  } finally {
    srv.close();
  }
}

test('/health con BD disponible -> 200 UP', () =>
  withApp({ ping: async () => true }, async (base) => {
    const res = await fetch(`${base}/health`);
    const { data } = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.service, 'vehicles-service');
    assert.equal(data.database, 'UP');
  }));

test('/health sin BD -> 503 DEGRADED', () =>
  withApp({ ping: async () => false }, async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).data.status, 'DEGRADED');
  }));

test('JSON inválido -> 400 VALIDATION_ERROR con requestId', () =>
  withApp({ ping: async () => true }, async (base) => {
    const res = await fetch(`${base}/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{malo' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.requestId);
  }));
