// Pruebas de la API de vehículos, independientes del almacenamiento.
// Se ejecutan con un repositorio en memoria (siempre) y con MySQL real (si está disponible).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {} };
const PREFIX = 'ZZ'; // placas de prueba: no chocan con el seed y se pueden limpiar

function runApiSuite(label, { db, repo, cleanup }) {
  let srv, base;
  const plate = () => PREFIX + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const call = async (method, path, body) => {
    const res = await fetch(base + '/api/v1/vehicles' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  before(async () => {
    srv = createApp({ db, logger: silent, repo }).listen(0);
    await new Promise((r) => srv.once('listening', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  after(async () => {
    srv.close();
    await cleanup?.();
  });

  test(`[${label}] crear y consultar por id y por placa (CA-03)`, async () => {
    const p = plate();
    const created = await call('POST', '/', { plate: p.toLowerCase(), vehicleType: 'CARRO', brand: 'Renault', color: 'Gris' });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.plate, p);
    assert.equal(created.body.data.status, 'ACTIVO');

    const byId = await call('GET', `/${created.body.data.id}`);
    assert.equal(byId.status, 200);
    assert.equal(byId.body.data.plate, p);

    const byPlate = await call('GET', `/plate/${encodeURIComponent(` ${p.slice(0, 3)} ${p.slice(3).toLowerCase()} `)}`);
    assert.equal(byPlate.status, 200);
    assert.equal(byPlate.body.data.id, created.body.data.id);

    const list = await call('GET', `/?search=${p}`);
    assert.equal(list.body.data.total, 1);
    assert.equal(list.body.data.items[0].plate, p);
  });

  test(`[${label}] placa duplicada -> 409 VEHICLE_ALREADY_EXISTS (CA-04)`, async () => {
    const p = plate();
    assert.equal((await call('POST', '/', { plate: p, vehicleType: 'MOTO' })).status, 201);
    const dup = await call('POST', '/', { plate: ` ${p.toLowerCase()} `, vehicleType: 'CARRO' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'VEHICLE_ALREADY_EXISTS');
  });

  test(`[${label}] actualizar datos y cambiar estado`, async () => {
    const { body } = await call('POST', '/', { plate: plate(), vehicleType: 'CARRO' });
    const id = body.data.id;
    const upd = await call('PATCH', `/${id}`, { color: 'Azul', brand: 'Kia' });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.data.color, 'Azul');
    assert.equal(upd.body.data.brand, 'Kia');

    const off = await call('PATCH', `/${id}/status`, { status: 'INACTIVO' });
    assert.equal(off.status, 200);
    assert.equal(off.body.data.status, 'INACTIVO');
  });

  test(`[${label}] cambiar a una placa ya usada -> 409`, async () => {
    const a = plate();
    await call('POST', '/', { plate: a, vehicleType: 'CARRO' });
    const { body } = await call('POST', '/', { plate: plate(), vehicleType: 'CARRO' });
    const res = await call('PATCH', `/${body.data.id}`, { plate: a });
    assert.equal(res.status, 409);
  });

  test(`[${label}] errores: 404, id inválido y validación`, async () => {
    const missing = await call('GET', '/00000000-0000-4000-8000-000000000000');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'VEHICLE_NOT_FOUND');
    assert.equal((await call('GET', '/plate/NOEXIST1')).status, 404);
    assert.equal((await call('GET', '/no-es-uuid')).status, 400);
    assert.equal((await call('PATCH', '/00000000-0000-4000-8000-000000000000', { color: 'x' })).status, 404);

    const bad = await call('POST', '/', { plate: 'A', vehicleType: 'AVION' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['plate', 'vehicleType']);
  });
}

module.exports = { runApiSuite, PREFIX };
