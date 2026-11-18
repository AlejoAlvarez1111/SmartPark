// Pruebas de la API de espacios, independientes del almacenamiento.
// Se ejecutan con un repositorio en memoria (siempre) y con MySQL real (si está disponible).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {} };
const ZONE = 'ZTEST'; // los espacios de prueba viven en esta zona y se borran al terminar
const minutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

function runApiSuite(label, { db, repo, cleanup }) {
  let srv, base;
  let seq = 0;
  const call = async (method, path, body) => {
    const res = await fetch(base + '/api/v1/spaces' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const newSpace = async (spaceType = 'ESTANDAR') => {
    const code = `Z${process.pid % 1000}-${++seq}${Math.floor(Math.random() * 100)}`;
    const r = await call('POST', '/', { code, zone: ZONE.toLowerCase(), spaceType });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  const occupy = (id, vehicleId, eventId = randomUUID()) => call('POST', `/${id}/occupy`, { vehicleId, eventId });
  const release = (id, eventId = randomUUID()) => call('POST', `/${id}/release`, { eventId });
  const syncRes = (rid, body) => call('PUT', `/internal/reservations/${rid}`, body);

  before(async () => {
    srv = createApp({ db, logger: silent, repo }).listen(0);
    await new Promise((r) => srv.once('listening', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  after(async () => {
    srv.close();
    await cleanup?.();
  });

  test(`[${label}] crear, consultar, editar y código duplicado`, async () => {
    const s = await newSpace('ACCESIBLE');
    assert.equal(s.status, 'DISPONIBLE');
    assert.equal(s.zone, ZONE);
    assert.equal((await call('GET', `/${s.id}`)).body.data.code, s.code);
    assert.equal((await call('POST', '/', { code: s.code.toLowerCase(), zone: ZONE, spaceType: 'ESTANDAR' })).body.error.code, 'SPACE_CODE_EXISTS');
    const upd = await call('PATCH', `/${s.id}`, { spaceType: 'ESTANDAR' });
    assert.equal(upd.body.data.spaceType, 'ESTANDAR');
  });

  test(`[${label}] listado con filtros y resumen coherente (CA-02)`, async () => {
    const s = await newSpace('MOTO');
    const list = (await call('GET', `/?zone=${ZONE}&type=MOTO`)).body.data;
    assert.ok(list.some((x) => x.id === s.id));
    assert.ok(list.every((x) => x.zone === ZONE && x.spaceType === 'MOTO'));

    const all = (await call('GET', '/')).body.data;
    const summary = (await call('GET', '/summary')).body.data;
    assert.equal(summary.total, all.length);
    for (const st of ['DISPONIBLE', 'OCUPADO', 'RESERVADO', 'FUERA_DE_SERVICIO']) {
      assert.equal(summary.byStatus[st], all.filter((x) => x.status === st).length, st);
    }
  });

  test(`[${label}] entrada, rechazo, duplicado y salida (CA-05..CA-08)`, async () => {
    const s = await newSpace();
    const vehicle = randomUUID();
    const eventId = randomUUID();

    const first = await occupy(s.id, vehicle, eventId);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.duplicate, false);
    assert.equal(first.body.data.space.status, 'OCUPADO');
    assert.equal(first.body.data.space.occupancy.vehicleId, vehicle);

    const again = await occupy(s.id, vehicle, eventId); // mismo evento
    assert.equal(again.status, 200);
    assert.equal(again.body.data.duplicate, true);
    assert.equal(again.body.data.occupancy.id, first.body.data.occupancy.id);

    const other = await occupy(s.id, randomUUID()); // otro vehículo, espacio ocupado
    assert.equal(other.status, 409);
    assert.equal(other.body.error.code, 'SPACE_NOT_AVAILABLE');
    assert.equal((await call('GET', `/${s.id}`)).body.data.occupancy.vehicleId, vehicle);

    const s2 = await newSpace();
    const twice = await occupy(s2.id, vehicle); // mismo vehículo en otro espacio
    assert.equal(twice.body.error.code, 'VEHICLE_ALREADY_PARKED');
    assert.equal((await call('GET', `/${s2.id}`)).body.data.status, 'DISPONIBLE');

    const exitId = randomUUID();
    const out = await release(s.id, exitId);
    assert.equal(out.status, 200);
    assert.equal(out.body.data.space.status, 'DISPONIBLE');
    assert.equal(out.body.data.space.occupancy, null);
    assert.equal(out.body.data.occupancy.status, 'CERRADA');

    assert.equal((await release(s.id, exitId)).body.data.duplicate, true);
    const notOccupied = await release(s.id);
    assert.equal(notOccupied.status, 409);
    assert.equal(notOccupied.body.error.code, 'INVALID_STATE_TRANSITION');
  });

  test(`[${label}] mantenimiento (RF-05)`, async () => {
    const s = await newSpace();
    const off = await call('PATCH', `/${s.id}/maintenance`, { outOfService: true });
    assert.equal(off.body.data.status, 'FUERA_DE_SERVICIO');
    assert.equal((await occupy(s.id, randomUUID())).body.error.code, 'SPACE_NOT_AVAILABLE');
    assert.equal((await call('PATCH', `/${s.id}/maintenance`, { outOfService: true })).status, 409);
    assert.equal((await call('GET', `/${s.id}/eligibility?startAt=${minutes(10)}&endAt=${minutes(70)}`)).body.data.eligible, false);
    assert.equal((await call('PATCH', `/${s.id}/maintenance`, { outOfService: false })).body.data.status, 'DISPONIBLE');

    await occupy(s.id, randomUUID());
    const busy = await call('PATCH', `/${s.id}/maintenance`, { outOfService: true });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, 'INVALID_STATE_TRANSITION');
    await release(s.id);
  });

  test(`[${label}] reservas: RESERVADO calculado, titular entra, otros no`, async () => {
    const s = await newSpace();
    const owner = randomUUID();
    const rid = randomUUID();
    const snap = { spaceId: s.id, vehicleId: owner, startAt: minutes(10), endAt: minutes(130), status: 'CONFIRMADA', updatedAt: minutes(0) };

    assert.equal((await syncRes(rid, snap)).body.data.applied, true);
    const reserved = (await call('GET', `/${s.id}`)).body.data;
    assert.equal(reserved.status, 'RESERVADO');
    assert.equal(reserved.nextReservation.id, rid);

    assert.equal((await call('PATCH', `/${s.id}/maintenance`, { outOfService: true })).status, 409);
    const intruder = await occupy(s.id, randomUUID());
    assert.equal(intruder.status, 409);
    assert.match(intruder.body.error.message, /reservado/);

    const entry = await occupy(s.id, owner);
    assert.equal(entry.status, 200);
    assert.equal(entry.body.data.occupancy.reservationId, rid);
    const exit = await release(s.id);
    // la reserva quedó COMPLETADA: el espacio no vuelve a RESERVADO
    assert.equal(exit.body.data.space.status, 'DISPONIBLE');
  });

  test(`[${label}] reservas lejanas no bloquean; cancelación y eventos desordenados`, async () => {
    const s = await newSpace();
    const rid = randomUUID();
    const t0 = minutes(0);
    const t1 = minutes(1);
    const far = { spaceId: s.id, vehicleId: randomUUID(), startAt: minutes(300), endAt: minutes(400), status: 'CONFIRMADA', updatedAt: t0 };
    await syncRes(rid, far);
    const sp = (await call('GET', `/${s.id}`)).body.data;
    assert.equal(sp.status, 'DISPONIBLE');
    assert.equal(sp.nextReservation.id, rid);

    const near = { ...far, startAt: minutes(5), endAt: minutes(60) };
    await syncRes(rid, { ...near, status: 'CANCELADA', updatedAt: t1 });
    assert.equal((await syncRes(rid, { ...near, updatedAt: t0 })).body.data.applied, false); // evento viejo
    assert.equal((await syncRes(rid, { ...near, status: 'CANCELADA', updatedAt: t1 })).body.data.applied, false); // repetido
    assert.equal((await call('GET', `/${s.id}`)).body.data.status, 'DISPONIBLE');
  });

  test(`[${label}] errores: 404, validación y espacio inexistente`, async () => {
    const missing = randomUUID();
    assert.equal((await call('GET', `/${missing}`)).body.error.code, 'SPACE_NOT_FOUND');
    assert.equal((await occupy(missing, randomUUID())).body.error.code, 'SPACE_NOT_FOUND');
    assert.equal((await release(missing)).status, 404);
    assert.equal((await call('GET', '/no-uuid')).status, 400);
    assert.equal((await call('GET', '/?status=ROTO')).status, 400);
    const bad = await call('POST', `/${missing}/occupy`, { vehicleId: 'x' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['eventId', 'vehicleId']);
    const badSnap = await syncRes(randomUUID(), { spaceId: missing, vehicleId: randomUUID(), startAt: minutes(1), endAt: minutes(2), status: 'CONFIRMADA', updatedAt: minutes(0) });
    assert.equal(badSnap.status, 404);
  });
}

module.exports = { runApiSuite, ZONE };
