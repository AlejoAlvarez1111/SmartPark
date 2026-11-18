// Pruebas de la API de sensores, independientes del almacenamiento.
// vehicles, spaces y reservations se sustituyen por dobles en memoria que respetan sus contratos HTTP.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { errors } = require('@smartpark/shared');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {} };
const SENSOR = 'ZTEST-SENSOR'; // los eventos de prueba se borran por este sensorId

function fakeServices() {
  const vehicles = new Map();
  const spaces = new Map(); // id -> { id, code, occupancy: { vehicleId, eventId, reservationId } | null, reservedFor }
  const down = { vehicles: false, spaces: false, reservations: false };
  const calls = { occupy: 0, release: 0, start: [], complete: [] };
  const ok = (data) => ({ status: 200, body: { success: true, data } });
  const err = (status, code, message) => ({ status, body: { success: false, error: { code, message } } });
  const guard = (name) => {
    if (down[name]) throw errors.unavailable(`El servicio ${name}-service no está disponible`);
  };
  const exitEvents = new Map();

  return {
    down,
    calls,
    addVehicle(status = 'ACTIVO') {
      const v = { id: randomUUID(), plate: `ZS${Math.floor(Math.random() * 1e4)}`, status };
      vehicles.set(v.id, v);
      return v;
    },
    addSpace({ reservedFor = null } = {}) {
      const s = { id: randomUUID(), code: `Z-${Math.floor(Math.random() * 1e4)}`, occupancy: null, reservedFor };
      spaces.set(s.id, s);
      return s;
    },
    async getVehicle(id) {
      guard('vehicles');
      return vehicles.has(id) ? ok(vehicles.get(id)) : err(404, 'VEHICLE_NOT_FOUND', 'El vehículo no existe');
    },
    async getSpace(id) {
      guard('spaces');
      return spaces.has(id) ? ok({ ...spaces.get(id) }) : err(404, 'SPACE_NOT_FOUND', 'El espacio no existe');
    },
    async occupy(id, { vehicleId, eventId }) {
      guard('spaces');
      calls.occupy++;
      const s = spaces.get(id);
      if (!s) return err(404, 'SPACE_NOT_FOUND', 'El espacio no existe');
      if (s.occupancy?.eventId === eventId) return ok({ duplicate: true, occupancy: s.occupancy, space: s });
      if (s.occupancy) return err(409, 'SPACE_NOT_AVAILABLE', 'El espacio no está disponible: ya está ocupado');
      const reservationId = s.reservedFor?.vehicleId === vehicleId ? s.reservedFor.id : null;
      s.occupancy = { id: randomUUID(), vehicleId, eventId, reservationId };
      return ok({ duplicate: false, occupancy: s.occupancy, space: { ...s, status: 'OCUPADO' } });
    },
    async release(id, { eventId }) {
      guard('spaces');
      calls.release++;
      const s = spaces.get(id);
      if (!s) return err(404, 'SPACE_NOT_FOUND', 'El espacio no existe');
      if (exitEvents.has(eventId)) return ok({ duplicate: true, occupancy: exitEvents.get(eventId), space: s });
      if (!s.occupancy) return err(409, 'INVALID_STATE_TRANSITION', 'El espacio no está ocupado: no hay salida que registrar');
      const closed = { ...s.occupancy, status: 'CERRADA' };
      exitEvents.set(eventId, closed);
      s.occupancy = null;
      return ok({ duplicate: false, occupancy: closed, space: { ...s, status: 'DISPONIBLE' } });
    },
    async startReservation(id) {
      guard('reservations');
      calls.start.push(id);
      return ok({ id, status: 'EN_CURSO' });
    },
    async completeReservation(id) {
      guard('reservations');
      calls.complete.push(id);
      return ok({ id, status: 'COMPLETADA' });
    },
  };
}

function runApiSuite(label, { db, repo, cleanup }) {
  const svc = fakeServices();
  let srv, base, app;
  const call = async (method, path, body) => {
    const res = await fetch(base + '/api/v1/sensors' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const entry = (space, vehicle, eventId = randomUUID()) =>
    call('POST', '/events/entry', { eventId, sensorId: SENSOR, spaceId: space.id, vehicleId: vehicle.id });
  const exit = (space, eventId = randomUUID()) => call('POST', '/events/exit', { eventId, sensorId: SENSOR, spaceId: space.id });

  before(async () => {
    app = createApp({ db, logger: silent, repo, clients: svc });
    srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  after(async () => {
    srv.close();
    await cleanup?.();
  });

  test(`[${label}] entrada procesada y queda en el historial (CA-05)`, async () => {
    const s = svc.addSpace();
    const v = svc.addVehicle();
    const eventId = randomUUID();
    const r = await entry(s, v, eventId);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.duplicate, false);
    assert.equal(r.body.data.space.status, 'OCUPADO');
    const ev = r.body.data.event;
    assert.equal(ev.status, 'PROCESADO');
    assert.equal(ev.eventType, 'VEHICLE_ENTERED');
    assert.equal(ev.plate, v.plate);
    assert.equal(ev.spaceCode, s.code);
    assert.ok(ev.processedAt);

    const history = (await call('GET', `/events?spaceId=${s.id}`)).body.data;
    assert.equal(history.length, 1);
    assert.equal(history[0].eventId, eventId);
  });

  test(`[${label}] evento duplicado: 200 DUPLICATE_EVENT, sin repetir el efecto (CA-08)`, async () => {
    const s = svc.addSpace();
    const v = svc.addVehicle();
    const eventId = randomUUID();
    await entry(s, v, eventId);
    const before = svc.calls.occupy;
    const dup = await entry(s, v, eventId);
    assert.equal(dup.status, 200);
    assert.equal(dup.body.data.duplicate, true);
    assert.match(dup.body.message, /DUPLICATE_EVENT/);
    assert.equal(svc.calls.occupy, before, 'no debe volver a llamar a spaces');
    assert.equal((await call('GET', `/events?spaceId=${s.id}`)).body.data.length, 1);

    const reused = await exit(s, eventId); // mismo eventId para otro tipo de evento
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, 'DUPLICATE_EVENT');
  });

  test(`[${label}] entrada en espacio ocupado: rechazada y registrada (CA-06)`, async () => {
    const s = svc.addSpace();
    await entry(s, svc.addVehicle());
    const other = svc.addVehicle();
    const eventId = randomUUID();
    const r = await entry(s, other, eventId);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'SPACE_NOT_AVAILABLE');
    assert.equal(r.body.error.details.event.status, 'RECHAZADO');
    assert.equal(r.body.error.details.event.plate, other.plate);

    const again = await entry(s, other, eventId); // reenviar un rechazo devuelve el mismo rechazo
    assert.equal(again.status, 409);
    assert.equal(again.body.error.details.duplicate, true);
    const rejected = (await call('GET', `/events?spaceId=${s.id}&status=RECHAZADO`)).body.data;
    assert.equal(rejected.length, 1);
  });

  test(`[${label}] vehículo o espacio inexistente, vehículo inactivo`, async () => {
    const s = svc.addSpace();
    const noVehicle = await entry(s, { id: randomUUID() });
    assert.equal(noVehicle.status, 404);
    assert.equal(noVehicle.body.error.code, 'VEHICLE_NOT_FOUND');
    assert.match(noVehicle.body.error.message, /regístrelo/);
    assert.equal((await entry(s, svc.addVehicle('INACTIVO'))).body.error.code, 'VEHICLE_INACTIVE');
    const noSpace = await entry({ id: randomUUID() }, svc.addVehicle());
    assert.equal(noSpace.status, 404);
    assert.equal(noSpace.body.error.code, 'SPACE_NOT_FOUND');
  });

  test(`[${label}] salida: libera y registra placa; salida sin ocupación se rechaza (CA-07)`, async () => {
    const s = svc.addSpace();
    const v = svc.addVehicle();
    await entry(s, v);
    const out = await exit(s);
    assert.equal(out.status, 201);
    assert.equal(out.body.data.space.status, 'DISPONIBLE');
    assert.equal(out.body.data.event.plate, v.plate);
    assert.equal(out.body.data.event.vehicleId, v.id);
    assert.equal(out.body.data.event.eventType, 'VEHICLE_EXITED');

    const none = await exit(s);
    assert.equal(none.status, 409);
    assert.equal(none.body.error.code, 'INVALID_STATE_TRANSITION');
  });

  test(`[${label}] spaces caído: 503 FALLIDO; reintentar el mismo eventId lo procesa`, async () => {
    const s = svc.addSpace();
    const v = svc.addVehicle();
    const eventId = randomUUID();
    svc.down.spaces = true;
    const r = await entry(s, v, eventId);
    svc.down.spaces = false;
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(r.body.error.details.event.status, 'FALLIDO');

    const retry = await entry(s, v, eventId);
    assert.equal(retry.status, 201);
    assert.equal(retry.body.data.event.status, 'PROCESADO');
    assert.equal((await call('GET', `/events?spaceId=${s.id}`)).body.data.length, 1, 'el reintento reutiliza el mismo registro');
  });

  test(`[${label}] titular de reserva: entrada inicia la reserva y salida la completa`, async () => {
    const v = svc.addVehicle();
    const reservationId = randomUUID();
    const s = svc.addSpace({ reservedFor: { id: reservationId, vehicleId: v.id } });
    const r = await entry(s, v);
    assert.equal(r.status, 201);
    assert.match(r.body.data.event.message, /con reserva/);
    assert.deepEqual(svc.calls.start.slice(-1), [reservationId]);
    await exit(s);
    assert.deepEqual(svc.calls.complete.slice(-1), [reservationId]);

    // reservations caído: el evento se procesa igual (el espacio ya es correcto) y avisa en el mensaje
    const v2 = svc.addVehicle();
    const s2 = svc.addSpace({ reservedFor: { id: randomUUID(), vehicleId: v2.id } });
    svc.down.reservations = true;
    const r2 = await entry(s2, v2);
    svc.down.reservations = false;
    assert.equal(r2.status, 201);
    assert.match(r2.body.data.event.message, /no se pudo actualizar la reserva/);
  });

  test(`[${label}] validación y filtros del historial`, async () => {
    const bad = await call('POST', '/events/entry', { sensorId: SENSOR, spaceId: 'x' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['eventId', 'spaceId', 'vehicleId']);
    const s = svc.addSpace();
    await entry(s, svc.addVehicle());
    await exit(s);
    const exits = (await call('GET', `/events?spaceId=${s.id}&type=VEHICLE_EXITED`)).body.data;
    assert.equal(exits.length, 1);
    assert.equal((await call('GET', '/events?limit=1')).body.data.length, 1);
    assert.equal((await call('GET', '/events?type=OTRO')).status, 400);
  });

  test(`[${label}] concurrencia: el mismo evento 5 veces a la vez -> un solo efecto`, async () => {
    const s = svc.addSpace();
    const v = svc.addVehicle();
    const input = { eventId: randomUUID(), sensorId: SENSOR, spaceId: s.id, vehicleId: v.id, source: 'MANUAL' };
    const before = svc.calls.occupy;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => app.locals.service.entry(input)));
    const processed = results.filter((r) => r.status === 'fulfilled' && !r.value.duplicate);
    assert.equal(processed.length, 1);
    // el resto: duplicado (200) o "en proceso" (409 DUPLICATE_EVENT)
    assert.ok(results.every((r) => r.status === 'fulfilled' || r.reason.code === 'DUPLICATE_EVENT'));
    assert.equal(svc.calls.occupy - before, 1);
  });
}

module.exports = { runApiSuite, SENSOR };
