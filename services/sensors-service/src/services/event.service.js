const { randomUUID } = require('node:crypto');
const { AppError, errors } = require('@smartpark/shared');

/**
 * Procesa eventos de sensores simulados (§10). No decide el estado del espacio: lo pide a spaces-service,
 * que es la fuente de verdad. Aquí se garantiza la idempotencia por eventId y se guarda el historial.
 *
 * Resultado de cada evento:
 *  - PROCESADO: el efecto se aplicó (201)
 *  - RECHAZADO: un servicio dueño lo rechazó por regla de negocio (4xx, se repite igual si se reenvía)
 *  - FALLIDO:   una dependencia no respondió (503); se puede reintentar con el mismo eventId
 */
function createEventService({ db, repo, clients, logger, now = () => new Date() }) {
  // Las llamadas lanzan 503 si el servicio no responde; aquí se convierten en una respuesta sin estado
  const safe = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError && err.status === 503) return { status: 0, body: null };
      throw err;
    }
  };
  const failed = (service) => ({
    status: 'FALLIDO',
    httpStatus: 503,
    resultCode: 'DEPENDENCY_UNAVAILABLE',
    message: `El servicio ${service} no está disponible; reintente el mismo evento`,
  });
  // Clasifica una respuesta no exitosa de otro servicio
  const outcomeOf = (service, r) =>
    r.status >= 400 && r.status < 500 && r.body?.error
      ? { status: 'RECHAZADO', httpStatus: r.status, resultCode: r.body.error.code, message: r.body.error.message }
      : failed(service);

  // Avisos a reservations-service: el estado del espacio ya es correcto aunque fallen, por eso no anulan el evento
  async function notifyReservation(action, reservationId, requestId) {
    const call = action === 'start' ? clients.startReservation : clients.completeReservation;
    const r = await safe(() => call(reservationId, requestId));
    if (r.status === 200) return '';
    logger.warn('No se pudo actualizar la reserva', { requestId, reservationId, action, status: r.status });
    return ' (no se pudo actualizar la reserva asociada; revísela en Reservas)';
  }

  async function processEntry(ev, requestId) {
    const [v, s] = await Promise.all([
      safe(() => clients.getVehicle(ev.vehicleId, requestId)),
      safe(() => clients.getSpace(ev.spaceId, requestId)),
    ]);
    if (v.status === 404) return { status: 'RECHAZADO', httpStatus: 404, resultCode: 'VEHICLE_NOT_FOUND', message: 'El vehículo no está registrado; regístrelo primero' };
    if (v.status !== 200) return failed('vehicles-service');
    const vehicle = v.body.data;
    const known = { plate: vehicle.plate, spaceCode: s.status === 200 ? s.body.data.code : null };
    if (s.status !== 200) return { ...known, ...outcomeOf('spaces-service', s) };
    if (vehicle.status !== 'ACTIVO') {
      return { ...known, status: 'RECHAZADO', httpStatus: 409, resultCode: 'VEHICLE_INACTIVE', message: `El vehículo ${vehicle.plate} está inactivo` };
    }

    const r = await safe(() => clients.occupy(ev.spaceId, { vehicleId: ev.vehicleId, eventId: ev.eventId }, requestId));
    if (r.status !== 200) return { ...known, ...outcomeOf('spaces-service', r) };
    const { occupancy, space, duplicate } = r.body.data;
    const note = occupancy.reservationId && !duplicate ? await notifyReservation('start', occupancy.reservationId, requestId) : '';
    return {
      ...known,
      space,
      status: 'PROCESADO',
      httpStatus: 201,
      resultCode: 'PROCESADO',
      message: `Entrada de ${vehicle.plate} registrada en ${space.code}${occupancy.reservationId ? ' (con reserva)' : ''}${note}`,
    };
  }

  async function processExit(ev, requestId) {
    const s = await safe(() => clients.getSpace(ev.spaceId, requestId));
    if (s.status !== 200) return outcomeOf('spaces-service', s);
    const spaceCode = s.body.data.code;

    const r = await safe(() => clients.release(ev.spaceId, { eventId: ev.eventId }, requestId));
    if (r.status !== 200) return { spaceCode, ...outcomeOf('spaces-service', r) };
    const { occupancy, space, duplicate } = r.body.data;
    // La placa es solo para el historial: si vehicles-service no responde, se guarda sin ella
    const v = await safe(() => clients.getVehicle(occupancy.vehicleId, requestId));
    const plate = v.status === 200 ? v.body.data.plate : null;
    const note = occupancy.reservationId && !duplicate ? await notifyReservation('complete', occupancy.reservationId, requestId) : '';
    return {
      spaceCode,
      plate,
      vehicleId: occupancy.vehicleId,
      space,
      status: 'PROCESADO',
      httpStatus: 201,
      resultCode: 'PROCESADO',
      message: `Salida${plate ? ` de ${plate}` : ''} registrada en ${spaceCode}${note}`,
    };
  }

  // Convierte un evento guardado en la respuesta HTTP (también al repetir un evento ya procesado)
  function respond(event, { duplicate, space }) {
    if (event.status === 'PROCESADO') return { duplicate, event, space: space ?? null };
    const details = { event, duplicate };
    if (event.status === 'FALLIDO') throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', event.message, details);
    throw new AppError(event.httpStatus, event.resultCode, event.message, details);
  }

  async function handle(eventType, input, requestId) {
    const ev = {
      id: randomUUID(),
      eventId: input.eventId,
      sensorId: input.sensorId,
      spaceId: input.spaceId,
      vehicleId: input.vehicleId ?? null,
      eventType,
      source: input.source,
      occurredAt: input.timestamp ?? now(),
    };

    try {
      await repo.insert(db.pool, ev);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      const existing = await repo.findByEventId(db.pool, ev.eventId);
      if (existing.eventType !== eventType || existing.spaceId !== ev.spaceId) {
        throw errors.conflict('DUPLICATE_EVENT', 'Ese eventId ya se usó para otro evento');
      }
      const retry = existing.status === 'FALLIDO' && (await repo.claimFailed(db.pool, ev.eventId));
      if (!retry) {
        if (existing.status === 'PENDIENTE') throw errors.conflict('DUPLICATE_EVENT', 'El evento se está procesando; consulte el historial en unos segundos');
        logger.info('Evento duplicado: se devuelve el resultado guardado', { requestId, eventId: ev.eventId, status: existing.status });
        return respond(existing, { duplicate: true });
      }
    }

    const outcome = await (eventType === 'VEHICLE_ENTERED' ? processEntry : processExit)(ev, requestId);
    const { space, status, httpStatus, resultCode, message, ...extra } = outcome;
    await repo.finish(db.pool, ev.eventId, { status, httpStatus, resultCode, message, processedAt: now(), ...extra });
    logger.info('Evento de sensor procesado', { requestId, eventId: ev.eventId, eventType, spaceId: ev.spaceId, status, resultCode });
    return respond(await repo.findByEventId(db.pool, ev.eventId), { duplicate: false, space });
  }

  return {
    entry: (input, requestId) => handle('VEHICLE_ENTERED', input, requestId),
    exit: (input, requestId) => handle('VEHICLE_EXITED', input, requestId),
    list: (filters) => repo.list(db.pool, filters),
  };
}

module.exports = { createEventService };
