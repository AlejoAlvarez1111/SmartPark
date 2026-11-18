const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isBlocking, deriveStatus, summarize } = require('../src/services/space.status');

const now = new Date('2026-11-20T14:00:00Z');
const HOLD = 60 * 60_000;
const at = (min) => new Date(now.getTime() + min * 60_000);
const res = (startMin, endMin) => ({ startAt: at(startMin), endAt: at(endMin) });

test('reserva bloquea si está vigente o empieza dentro de la ventana', () => {
  assert.equal(isBlocking(res(-30, 30), now, HOLD), true); // en curso
  assert.equal(isBlocking(res(45, 120), now, HOLD), true); // empieza en 45 min
  assert.equal(isBlocking(res(60, 120), now, HOLD), true); // justo en el límite
  assert.equal(isBlocking(res(61, 120), now, HOLD), false); // aún lejos
  assert.equal(isBlocking(res(-120, 0), now, HOLD), false); // ya terminó
  assert.equal(isBlocking(undefined, now, HOLD), false);
});

test('prioridad de estados: fuera de servicio > ocupado > reservado > disponible', () => {
  const blocking = res(0, 60);
  assert.equal(deriveStatus('FUERA_DE_SERVICIO', blocking, now, HOLD), 'FUERA_DE_SERVICIO');
  assert.equal(deriveStatus('OCUPADO', blocking, now, HOLD), 'OCUPADO');
  assert.equal(deriveStatus('DISPONIBLE', blocking, now, HOLD), 'RESERVADO');
  assert.equal(deriveStatus('DISPONIBLE', res(300, 400), now, HOLD), 'DISPONIBLE');
  assert.equal(deriveStatus('DISPONIBLE', null, now, HOLD), 'DISPONIBLE');
});

test('resumen por estado y por tipo', () => {
  const s = summarize([
    { status: 'DISPONIBLE', spaceType: 'ESTANDAR' },
    { status: 'OCUPADO', spaceType: 'ESTANDAR' },
    { status: 'RESERVADO', spaceType: 'MOTO' },
  ]);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byStatus, { DISPONIBLE: 1, OCUPADO: 1, RESERVADO: 1, FUERA_DE_SERVICIO: 0 });
  assert.equal(s.byType.ESTANDAR.total, 2);
  assert.equal(s.byType.MOTO.RESERVADO, 1);
});
