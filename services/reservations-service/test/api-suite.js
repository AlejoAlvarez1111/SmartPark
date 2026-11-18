// Pruebas de la API de reservas, independientes del almacenamiento.
// vehicles-service y spaces-service se sustituyen por clientes falsos controlables desde la prueba.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AppError, errors } = require('@smartpark/shared');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {} };
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();

function fakeClients() {
  const vehicles = new Map();
  const spaces = new Map();
  const pushes = [];
  const state = { spacesDown: false };
  return {
    state,
    pushes,
    addVehicle(status = 'ACTIVO') {
      const v = { id: randomUUID(), plate: `ZR${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`, status };
      vehicles.set(v.id, v);
      return v;
    },
    addSpace({ eligible = true, reason = null } = {}) {
      const s = { id: randomUUID(), code: `Z-${Math.floor(Math.random() * 1e4)}`, eligible, reason };
      spaces.set(s.id, s);
      return s;
    },
    async getVehicle(id) {
      const v = vehicles.get(id);
      if (!v) throw new AppError(404, 'VEHICLE_NOT_FOUND', 'El vehículo no existe');
      return v;
    },
    async checkEligibility(id) {
      if (state.spacesDown) throw errors.unavailable('El servicio spaces-service no está disponible');
      const s = spaces.get(id);
      if (!s) throw new AppError(404, 'SPACE_NOT_FOUND', 'El espacio no existe');
      return { eligible: s.eligible, reason: s.reason, space: { id: s.id, code: s.code } };
    },
    async pushReservation(reservationId, snapshot) {
      if (state.spacesDown) throw errors.unavailable('El servicio spaces-service no está disponible');
      pushes.push({ reservationId, snapshot });
      return { status: 200, body: { success: true, data: { applied: true } } };
    },
  };
}

function runApiSuite(label, { db, repo, createdIds = [], cleanup }) {
  const clients = fakeClients();
  let srv, base, app;
  const call = async (method, path, body) => {
    const res = await fetch(base + '/api/v1/reservations' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (method === 'POST' && path === '/' && res.status === 201) createdIds.push(json.data.id);
    return { status: res.status, body: json };
  };
  const reserve = (vehicle, space, startMin, endMin) =>
    call('POST', '/', { vehicleId: vehicle.id, spaceId: space.id, startAt: inMin(startMin), endAt: inMin(endMin) });

  before(async () => {
    app = createApp({ db, logger: silent, repo, clients });
    srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  after(async () => {
    srv.close();
    await cleanup?.();
  });

  test(`[${label}] crear reserva: CONFIRMADA, código, copias y aviso a espacios`, async () => {
    const v = clients.addVehicle();
    const s = clients.addSpace();
    const r = await reserve(v, s, 60, 180);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = r.body.data;
    assert.equal(d.status, 'CONFIRMADA');
    assert.match(d.code, /^R-[A-Z2-9]{8}$/);
    assert.equal(d.plate, v.plate);
    assert.equal(d.spaceCode, s.code);
    assert.equal(d.spaceSync, 'ENTREGADO');
    const push = clients.pushes.at(-1);
    assert.equal(push.reservationId, d.id);
    assert.equal(push.snapshot.status, 'CONFIRMADA');
    assert.equal(push.snapshot.spaceId, s.id);

    assert.equal((await call('GET', `/${d.id}`)).body.data.code, d.code);
  });

  test(`[${label}] reservas superpuestas se rechazan; contiguas no (CA-09)`, async () => {
    const s = clients.addSpace();
    assert.equal((await reserve(clients.addVehicle(), s, 60, 180)).status, 201);
    const overlap = await reserve(clients.addVehicle(), s, 120, 240);
    assert.equal(overlap.status, 409);
    assert.equal(overlap.body.error.code, 'RESERVATION_CONFLICT');
    assert.equal((await reserve(clients.addVehicle(), s, 30, 61)).status, 409);
    assert.equal((await reserve(clients.addVehicle(), s, 180, 240)).status, 201); // empieza cuando termina la otra

    const v = clients.addVehicle();
    await reserve(v, clients.addSpace(), 300, 360);
    const sameVehicle = await reserve(v, clients.addSpace(), 330, 400);
    assert.equal(sameVehicle.status, 409);
    assert.match(sameVehicle.body.error.message, /vehículo/);
  });

  test(`[${label}] validaciones: pasado, fin antes del inicio, vehículo y espacio`, async () => {
    const v = clients.addVehicle();
    const s = clients.addSpace();
    const past = await reserve(v, s, -30, 60);
    assert.equal(past.status, 400);
    assert.equal(past.body.error.details[0].field, 'startAt');
    assert.equal((await reserve(v, s, 120, 60)).status, 400);

    assert.equal((await reserve({ id: randomUUID() }, s, 60, 120)).body.error.code, 'VEHICLE_NOT_FOUND');
    assert.equal((await reserve(clients.addVehicle('INACTIVO'), s, 60, 120)).body.error.code, 'VEHICLE_INACTIVE');
    assert.equal((await reserve(v, { id: randomUUID() }, 60, 120)).body.error.code, 'SPACE_NOT_FOUND');
    const blocked = await reserve(v, clients.addSpace({ eligible: false, reason: 'El espacio está fuera de servicio' }), 60, 120);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'SPACE_NOT_AVAILABLE');
  });

  test(`[${label}] cancelar: CANCELADA, avisa a espacios, libera el horario (CA-10)`, async () => {
    const s = clients.addSpace();
    const { body } = await reserve(clients.addVehicle(), s, 60, 120);
    const id = body.data.id;
    const cancel = await call('POST', `/${id}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.data.status, 'CANCELADA');
    assert.ok(cancel.body.data.cancelledAt);
    assert.equal(cancel.body.data.spaceSync, 'ENTREGADO');
    const push = clients.pushes.at(-1);
    assert.equal(push.snapshot.status, 'CANCELADA');
    assert.ok(new Date(push.snapshot.updatedAt) > new Date(body.data.updatedAt), 'updatedAt debe avanzar');

    const again = await call('POST', `/${id}/cancel`);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.spaceSync, 'SIN_CAMBIOS');
    assert.equal((await call('POST', `/${id}/complete`)).body.error.code, 'INVALID_STATE_TRANSITION');
    assert.equal((await reserve(clients.addVehicle(), s, 60, 120)).status, 201);
  });

  test(`[${label}] en curso (interno) y completar`, async () => {
    const { body } = await reserve(clients.addVehicle(), clients.addSpace(), 10, 70);
    const id = body.data.id;
    assert.equal((await call('POST', `/internal/${id}/start`)).body.data.status, 'EN_CURSO');
    assert.equal((await call('POST', `/${id}/cancel`)).status, 409);
    const done = await call('POST', `/${id}/complete`);
    assert.equal(done.body.data.status, 'COMPLETADA');
    assert.equal(clients.pushes.at(-1).snapshot.status, 'COMPLETADA');
  });

  test(`[${label}] listado con filtros`, async () => {
    const v = clients.addVehicle();
    const s = clients.addSpace();
    const { body } = await reserve(v, s, 60, 120);
    const byPlate = (await call('GET', `/?plate=${v.plate.toLowerCase()}`)).body.data;
    assert.equal(byPlate.total, 1);
    assert.equal(byPlate.items[0].id, body.data.id);
    assert.equal((await call('GET', `/?spaceId=${s.id}&status=CONFIRMADA`)).body.data.total, 1);
    assert.equal((await call('GET', `/?spaceId=${s.id}&status=CANCELADA`)).body.data.total, 0);
    const day = inMin(90).slice(0, 10);
    assert.ok((await call('GET', `/?date=${day}&spaceId=${s.id}`)).body.data.items.some((r) => r.id === body.data.id));
    assert.equal((await call('GET', '/?status=RARA')).status, 400);
  });

  test(`[${label}] espacios caído: 503 al crear; aviso pendiente se reintenta y agota intentos`, async () => {
    const v = clients.addVehicle();
    const s = clients.addSpace();
    clients.state.spacesDown = true;
    const down = await reserve(v, s, 60, 120);
    assert.equal(down.status, 503);
    assert.equal(down.body.error.code, 'DEPENDENCY_UNAVAILABLE');
    clients.state.spacesDown = false;

    // La reserva se crea; spaces cae justo antes de cancelar: el cambio queda PENDIENTE y se entrega después
    const { body } = await reserve(v, s, 60, 120);
    clients.state.spacesDown = true;
    const cancel = await call('POST', `/${body.data.id}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.data.spaceSync, 'PENDIENTE');
    clients.state.spacesDown = false;
    const before = clients.pushes.length;
    await app.locals.dispatcher.flush();
    const delivered = clients.pushes.slice(before).find((p) => p.reservationId === body.data.id);
    assert.equal(delivered.snapshot.status, 'CANCELADA');

    // Sin servicio, tras OUTBOX_MAX_ATTEMPTS intentos el evento queda FALLIDO y deja de reintentarse
    const other = await reserve(clients.addVehicle(), clients.addSpace(), 60, 120);
    clients.state.spacesDown = true;
    const c2 = await call('POST', `/${other.body.data.id}/cancel`);
    assert.equal(c2.body.data.spaceSync, 'PENDIENTE');
    for (let i = 0; i < 10; i++) await app.locals.dispatcher.flush();
    clients.state.spacesDown = false;
    const n = clients.pushes.length;
    await app.locals.dispatcher.flush();
    assert.equal(clients.pushes.slice(n).some((p) => p.reservationId === other.body.data.id), false);
  });

  test(`[${label}] errores: 404 y id inválido`, async () => {
    assert.equal((await call('GET', `/${randomUUID()}`)).body.error.code, 'RESERVATION_NOT_FOUND');
    assert.equal((await call('POST', `/${randomUUID()}/cancel`)).status, 404);
    assert.equal((await call('GET', '/xyz')).status, 400);
  });

  test(`[${label}] concurrencia: 5 reservas simultáneas del mismo espacio y horario -> 1 éxito`, async () => {
    // Directo al servicio: por HTTP local las solicitudes llegan en serie y no se intercalarían
    const s = clients.addSpace();
    const input = () => ({ vehicleId: clients.addVehicle().id, spaceId: s.id, startAt: new Date(inMin(400)), endAt: new Date(inMin(460)) });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => app.locals.service.create(input())));
    results.filter((r) => r.status === 'fulfilled').forEach((r) => createdIds.push(r.value.id));
    const outcome = results.map((r) => (r.status === 'fulfilled' ? 'OK' : r.reason.code)).sort();
    assert.deepEqual(outcome, ['OK', 'RESERVATION_CONFLICT', 'RESERVATION_CONFLICT', 'RESERVATION_CONFLICT', 'RESERVATION_CONFLICT']);
  });
}

module.exports = { runApiSuite };
