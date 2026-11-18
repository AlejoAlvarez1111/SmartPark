const { randomUUID, randomInt } = require('node:crypto');
const { errors, AppError } = require('@smartpark/shared');
const { TRANSITIONS, transitionResult, startsTooEarly } = require('./reservation.rules');

const notFound = () => errors.notFound('RESERVATION_NOT_FOUND', 'La reserva no existe');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
const newCode = () => 'R-' + Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const iso = (d) => new Date(d).toISOString();
const fmt = (d) => iso(d).replace('T', ' ').slice(0, 16) + ' UTC';

// Lo que spaces-service necesita para calcular RESERVADO
const snapshotOf = (r) => ({
  reservationId: r.id,
  snapshot: { spaceId: r.spaceId, vehicleId: r.vehicleId, startAt: iso(r.startAt), endAt: iso(r.endAt), status: r.status, updatedAt: iso(r.updatedAt) },
});

/**
 * Ciclo de vida de las reservas (§7.3). Dueño exclusivo de smartpark_reservations.
 * Consulta vehículos y espacios por HTTP y notifica cada cambio a spaces-service mediante el outbox.
 */
function createReservationService({ db, repo, clients, dispatcher, pastToleranceMinutes, now = () => new Date() }) {
  async function create({ vehicleId, spaceId, startAt, endAt }, requestId) {
    if (startsTooEarly(startAt, now(), pastToleranceMinutes)) {
      throw errors.validation('Datos de entrada inválidos', [{ field: 'startAt', message: 'La reserva no puede empezar en el pasado' }]);
    }

    // Validaciones remotas antes de bloquear: los servicios dueños deciden sobre sus datos
    const vehicle = await clients.getVehicle(vehicleId, requestId);
    if (vehicle.status !== 'ACTIVO') throw errors.conflict('VEHICLE_INACTIVE', `El vehículo ${vehicle.plate} está inactivo`);
    const eligibility = await clients.checkEligibility(spaceId, { startAt, endAt }, requestId);
    if (!eligibility.eligible) throw errors.conflict('SPACE_NOT_AVAILABLE', `El espacio no está disponible: ${eligibility.reason}`);

    const { reservation, eventId } = await repo.withSpaceLock(db.pool, spaceId, async (conn) => {
      // shortcut: el bloqueo es por espacio; dos reservas simultáneas del mismo vehículo en espacios distintos podrían colarse
      const conflicts = await repo.findConflicts(conn, { spaceId, vehicleId, startAt, endAt });
      const sameSpace = conflicts.find((c) => c.spaceId === spaceId);
      if (sameSpace) {
        throw errors.conflict('RESERVATION_CONFLICT', `El espacio ya tiene la reserva ${sameSpace.code} de ${fmt(sameSpace.startAt)} a ${fmt(sameSpace.endAt)}`);
      }
      if (conflicts.length) {
        throw errors.conflict('RESERVATION_CONFLICT', `El vehículo ya tiene la reserva ${conflicts[0].code} en ese horario`);
      }

      const id = randomUUID();
      const base = { id, vehicleId, spaceId, plate: vehicle.plate, spaceCode: eligibility.space.code, startAt, endAt };
      for (let attempt = 1; ; attempt++) {
        try {
          await repo.insert(conn, { ...base, code: newCode() });
          break;
        } catch (err) {
          // Choque de código aleatorio (muy improbable): se genera otro
          if (!(err.code === 'ER_DUP_ENTRY' && String(err.message).includes('uq_res_code') && attempt < 5)) throw err;
        }
      }
      const created = await repo.findById(conn, id);
      return { reservation: created, eventId: await repo.insertOutbox(conn, 'RESERVATION_CREATED', snapshotOf(created)) };
    });

    return { ...reservation, spaceSync: await dispatcher.deliver(eventId, requestId) };
  }

  async function transition(id, action, requestId) {
    const { to } = TRANSITIONS[action];
    const result = await db.transaction(async (conn) => {
      const current = await repo.findById(conn, id, { forUpdate: true });
      if (!current) throw notFound();
      const decision = transitionResult(action, current.status);
      if (decision === 'noop') return { reservation: current, eventId: null };
      if (decision === 'invalid') {
        throw new AppError(409, 'INVALID_STATE_TRANSITION', `No se puede pasar una reserva ${current.status} a ${to}`);
      }
      await repo.updateStatus(conn, id, to);
      const updated = await repo.findById(conn, id);
      return { reservation: updated, eventId: await repo.insertOutbox(conn, `RESERVATION_${to}`, snapshotOf(updated)) };
    });
    const spaceSync = result.eventId ? await dispatcher.deliver(result.eventId, requestId) : 'SIN_CAMBIOS';
    return { ...result.reservation, spaceSync };
  }

  return {
    create,
    list: (filters) => repo.list(db.pool, filters),
    async get(id) {
      return (await repo.findById(db.pool, id)) ?? Promise.reject(notFound());
    },
    cancel: (id, requestId) => transition(id, 'cancel', requestId),
    start: (id, requestId) => transition(id, 'start', requestId),
    complete: (id, requestId) => transition(id, 'complete', requestId),
  };
}

module.exports = { createReservationService, snapshotOf };
