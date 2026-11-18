const { test } = require('node:test');
const assert = require('node:assert/strict');
const { overlaps, transitionResult, startsTooEarly } = require('../src/services/reservation.rules');
const v = require('../src/validators/reservation.validator');

const h = (hour) => new Date(`2026-11-20T${String(hour).padStart(2, '0')}:00:00Z`);
const r = (a, b) => ({ startAt: h(a), endAt: h(b) });

test('solapamiento de intervalos [inicio, fin)', () => {
  assert.equal(overlaps(r(14, 16), r(15, 17)), true);
  assert.equal(overlaps(r(14, 16), r(13, 15)), true);
  assert.equal(overlaps(r(14, 16), r(14, 16)), true);
  assert.equal(overlaps(r(14, 18), r(15, 16)), true); // contenida
  assert.equal(overlaps(r(14, 16), r(16, 18)), false); // contiguas
  assert.equal(overlaps(r(14, 16), r(10, 14)), false);
});

test('transiciones de estado', () => {
  assert.equal(transitionResult('cancel', 'CONFIRMADA'), 'apply');
  assert.equal(transitionResult('cancel', 'CANCELADA'), 'noop');
  assert.equal(transitionResult('cancel', 'EN_CURSO'), 'invalid');
  assert.equal(transitionResult('cancel', 'COMPLETADA'), 'invalid');
  assert.equal(transitionResult('start', 'CONFIRMADA'), 'apply');
  assert.equal(transitionResult('start', 'CANCELADA'), 'invalid');
  assert.equal(transitionResult('complete', 'EN_CURSO'), 'apply');
  assert.equal(transitionResult('complete', 'CONFIRMADA'), 'apply');
  assert.equal(transitionResult('complete', 'CANCELADA'), 'invalid');
});

test('inicio en el pasado con tolerancia', () => {
  const now = h(14);
  assert.equal(startsTooEarly(new Date(now - 4 * 60_000), now, 5), false);
  assert.equal(startsTooEarly(new Date(now - 6 * 60_000), now, 5), true);
});

test('validación de fechas de reserva', () => {
  const ids = { vehicleId: '00000000-0000-4000-8000-000000000001', spaceId: '00000000-0000-4000-8000-000000000002' };
  assert.equal(v.createReservationSchema.safeParse({ ...ids, startAt: '2026-11-20T14:00:00Z', endAt: '2026-11-20T16:00:00Z' }).success, true);
  assert.equal(v.createReservationSchema.safeParse({ ...ids, startAt: '2026-11-20T16:00:00Z', endAt: '2026-11-20T14:00:00Z' }).success, false);
  assert.equal(v.createReservationSchema.safeParse({ ...ids, startAt: '2026-11-20T14:00:00Z', endAt: '2026-11-20T14:00:00Z' }).success, false);
  assert.equal(v.createReservationSchema.safeParse({ ...ids, startAt: 'mañana', endAt: '2026-11-20T14:00:00Z' }).success, false);
});

test('filtro date = día UTC completo', () => {
  const q = v.listQuerySchema.parse({ date: '2026-11-20', plate: ' abc-123 ' });
  assert.equal(q.from.toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(q.to.toISOString(), '2026-11-21T00:00:00.000Z');
  assert.equal(q.plate, 'ABC123');
  assert.equal(v.listQuerySchema.safeParse({ date: '2026-11-20', from: '2026-11-20T00:00:00Z' }).success, false);
});
