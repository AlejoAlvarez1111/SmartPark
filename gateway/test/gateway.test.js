const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {} };
const listen = (handler) =>
  new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, () => resolve(srv));
  });
const urlOf = (srv) => `http://127.0.0.1:${srv.address().port}`;

let fakeVehicles, gateway, base, lastRequest;

before(async () => {
  // Servicio falso que responde como lo haría vehicles-service
  fakeVehicles = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastRequest = { method: req.method, url: req.url, requestId: req.headers['x-request-id'], body };
      res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { status: 'UP', database: 'UP', echo: body } }));
    });
  });
  const config = {
    version: 'test',
    timeoutMs: 500,
    frontendOrigin: 'http://localhost:5500',
    services: {
      vehicles: { name: 'vehicles-service', url: urlOf(fakeVehicles) },
      spaces: { name: 'spaces-service', url: 'http://127.0.0.1:1' }, // puerto cerrado: servicio caído
      sensors: { name: 'sensors-service', url: urlOf(fakeVehicles) },
    },
  };
  gateway = await listen(createApp({ config, logger: silent }));
  base = urlOf(gateway);
});

after(() => {
  fakeVehicles.close();
  gateway.close();
});

test('reenvía al servicio dueño con método, query, body y X-Request-ID', async () => {
  const res = await fetch(`${base}/api/v1/vehicles?search=abc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-123' },
    body: JSON.stringify({ plate: 'ABC123' }),
  });
  assert.equal(res.status, 201);
  assert.equal(lastRequest.method, 'POST');
  assert.equal(lastRequest.url, '/api/v1/vehicles?search=abc');
  assert.equal(lastRequest.requestId, 'req-123');
  assert.deepEqual(JSON.parse(lastRequest.body), { plate: 'ABC123' });
});

test('servicio caído -> 503 DEPENDENCY_UNAVAILABLE controlado', async () => {
  const res = await fetch(`${base}/api/v1/spaces`);
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.ok(body.requestId);
  assert.equal(JSON.stringify(body).includes('stack'), false);
});

test('/health informa cada servicio sin caerse si uno no responde', async () => {
  const { data } = await (await fetch(`${base}/health`)).json();
  assert.equal(data.status, 'DEGRADED');
  assert.equal(data.services.vehicles.status, 'UP');
  assert.equal(data.services.spaces.status, 'DOWN');
});

test('/dashboard agrega lo disponible y nombra lo caído sin inventar datos', async () => {
  const res = await fetch(`${base}/api/v1/dashboard`);
  const { data } = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.summary, null);
  assert.equal(data.spaces, null);
  assert.ok(data.recentEvents); // sensors responde
  assert.deepEqual(data.unavailable, ['spaces-service']);
});

test('las rutas /internal/ no se exponen por el gateway', async () => {
  lastRequest = null;
  const res = await fetch(`${base}/api/v1/vehicles/internal/algo`, { method: 'PUT' });
  assert.equal(res.status, 404);
  assert.equal(lastRequest, null);
});

test('recurso desconocido bajo /api -> 404 JSON', async () => {
  const res = await fetch(`${base}/api/v1/nada`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});
