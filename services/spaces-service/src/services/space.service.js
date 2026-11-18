const { randomUUID } = require('node:crypto');
const { errors } = require('@smartpark/shared');
const { deriveStatus, isBlocking, summarize } = require('./space.status');

const spaceNotFound = () => errors.notFound('SPACE_NOT_FOUND', 'El espacio no existe');
const notAvailable = (why) => errors.conflict('SPACE_NOT_AVAILABLE', `El espacio no está disponible: ${why}`);
const invalidTransition = (msg) => errors.conflict('INVALID_STATE_TRANSITION', msg);
const isDup = (err, key) => err.code === 'ER_DUP_ENTRY' && (!key || String(err.message).includes(key));

/**
 * Reglas del inventario y la ocupación. spaces-service es la fuente de verdad del estado (§7.2).
 * `db` = { pool, transaction }; `repo` = funciones SQL (o un doble en memoria en las pruebas).
 */
function createSpaceService({ db, repo, holdMinutes, now = () => new Date() }) {
  const holdMs = holdMinutes * 60_000;

  const toApi = (space, nextReservation, at) => ({
    id: space.id,
    code: space.code,
    zone: space.zone,
    spaceType: space.spaceType,
    status: deriveStatus(space.status, nextReservation, at, holdMs),
    occupancy: space.occupancy ?? null,
    nextReservation: nextReservation
      ? { id: nextReservation.id, vehicleId: nextReservation.vehicleId, startAt: nextReservation.startAt, endAt: nextReservation.endAt }
      : null,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  });

  async function list(filters = {}) {
    const at = now();
    const [spaces, next] = await Promise.all([repo.listSpaces(db.pool, filters), repo.nextReservationsBySpace(db.pool, at, filters.id)]);
    const result = spaces.map((s) => toApi(s, next.get(s.id), at));
    // shortcut: el filtro por estado se aplica en memoria porque RESERVADO es calculado; basta para decenas de espacios
    return filters.status ? result.filter((s) => s.status === filters.status) : result;
  }

  async function get(id) {
    const [space] = await list({ id });
    if (!space) throw spaceNotFound();
    return space;
  }

  const codeExists = (code) => errors.conflict('SPACE_CODE_EXISTS', `Ya existe un espacio con el código ${code}`);

  async function create(data) {
    const id = randomUUID();
    try {
      await repo.insertSpace(db.pool, { id, ...data });
    } catch (err) {
      throw isDup(err) ? codeExists(data.code) : err;
    }
    return get(id);
  }

  async function update(id, fields) {
    if (!(await repo.findSpace(db.pool, id))) throw spaceNotFound();
    try {
      await repo.updateSpace(db.pool, id, fields);
    } catch (err) {
      throw isDup(err) ? codeExists(fields.code) : err;
    }
    return get(id);
  }

  /**
   * Registra la entrada de un vehículo. Idempotente por eventId.
   * Concurrencia: SELECT ... FOR UPDATE serializa las entradas al mismo espacio, el UPDATE es condicional
   * y los índices únicos de occupancies son la última barrera (§6.5, §14.4).
   */
  async function occupy({ id, vehicleId, eventId }) {
    let result;
    try {
      result = await db.transaction(async (conn) => {
        const previous = await repo.findOccupancyBySourceEvent(conn, eventId);
        if (previous) return { duplicate: true, occupancy: previous };

        const space = await repo.findSpace(conn, id, { forUpdate: true });
        if (!space) throw spaceNotFound();
        if (space.status === 'FUERA_DE_SERVICIO') throw notAvailable('está fuera de servicio');
        if (space.status === 'OCUPADO') {
          // Lectura bloqueante (ve lo último confirmado): si lo ocupó este mismo evento en paralelo, es un duplicado
          const open = await repo.findOpenOccupancyBySpace(conn, id, { forUpdate: true });
          if (open?.sourceEventId === eventId) return { duplicate: true, occupancy: open };
          throw notAvailable('ya está ocupado');
        }

        const at = now();
        const next = (await repo.nextReservationsBySpace(conn, at, id)).get(id);
        let reservationId = null;
        if (isBlocking(next, at, holdMs)) {
          if (next.vehicleId !== vehicleId) throw notAvailable('está reservado para otro vehículo');
          reservationId = next.id; // el titular de la reserva entra a su espacio
        }

        if (await repo.findOpenOccupancyByVehicle(conn, vehicleId)) {
          throw errors.conflict('VEHICLE_ALREADY_PARKED', 'El vehículo ya está estacionado en otro espacio');
        }
        if (!(await repo.setSpaceStatus(conn, id, 'DISPONIBLE', 'OCUPADO'))) throw notAvailable('su estado cambió');

        const occupancy = { id: randomUUID(), spaceId: id, vehicleId, reservationId, entryAt: at, exitAt: null, sourceEventId: eventId, exitEventId: null, status: 'ABIERTA' };
        await repo.insertOccupancy(conn, occupancy);
        if (reservationId) await repo.setReservationStatus(conn, reservationId, 'EN_CURSO');
        return { duplicate: false, occupancy };
      });
    } catch (err) {
      // Dos entregas simultáneas del mismo evento: la segunda choca con el índice único y se trata como duplicado
      if (isDup(err, 'uq_occ_source_event')) result = { duplicate: true, occupancy: await repo.findOccupancyBySourceEvent(db.pool, eventId) };
      else if (isDup(err, 'uq_occ_open_vehicle')) throw errors.conflict('VEHICLE_ALREADY_PARKED', 'El vehículo ya está estacionado en otro espacio');
      else if (isDup(err)) throw notAvailable('ya está ocupado');
      else throw err;
    }
    return { ...result, space: await get(result.occupancy.spaceId) };
  }

  // Registra la salida: cierra la ocupación abierta. Idempotente por eventId.
  async function release({ id, eventId }) {
    const result = await db.transaction(async (conn) => {
      const previous = await repo.findOccupancyByExitEvent(conn, eventId);
      if (previous) return { duplicate: true, occupancy: previous };

      if (!(await repo.findSpace(conn, id, { forUpdate: true }))) throw spaceNotFound();
      const open = await repo.findOpenOccupancyBySpace(conn, id, { forUpdate: true });
      if (!open) {
        // ¿La cerró este mismo evento en paralelo? La primera lectura pudo ver una foto anterior
        const closed = await repo.findOccupancyByExitEvent(conn, eventId, { forUpdate: true });
        if (closed) return { duplicate: true, occupancy: closed };
        throw invalidTransition('El espacio no está ocupado: no hay salida que registrar');
      }

      const exitAt = now();
      await repo.closeOccupancy(conn, open.id, exitAt, eventId);
      await repo.setSpaceStatus(conn, id, 'OCUPADO', 'DISPONIBLE');
      if (open.reservationId) await repo.setReservationStatus(conn, open.reservationId, 'COMPLETADA');
      return { duplicate: false, occupancy: { ...open, exitAt, exitEventId: eventId, status: 'CERRADA' } };
    });
    return { ...result, space: await get(result.occupancy.spaceId) };
  }

  // RF-05: fuera de servicio solo si está libre y sin reservas vigentes o futuras; volver solo desde fuera de servicio
  async function setMaintenance({ id, outOfService }) {
    await db.transaction(async (conn) => {
      const space = await repo.findSpace(conn, id, { forUpdate: true });
      if (!space) throw spaceNotFound();
      if (!outOfService) {
        if (space.status !== 'FUERA_DE_SERVICIO') throw invalidTransition('El espacio no está fuera de servicio');
        return repo.setSpaceStatus(conn, id, 'FUERA_DE_SERVICIO', 'DISPONIBLE');
      }
      if (space.status === 'FUERA_DE_SERVICIO') throw invalidTransition('El espacio ya está fuera de servicio');
      if (space.status === 'OCUPADO') throw invalidTransition('No se puede poner fuera de servicio un espacio ocupado');
      if (await repo.countActiveReservations(conn, id, now())) {
        throw invalidTransition('El espacio tiene reservas vigentes o futuras; cancélalas primero');
      }
      return repo.setSpaceStatus(conn, id, 'DISPONIBLE', 'FUERA_DE_SERVICIO');
    });
    return get(id);
  }

  // Consulta para reservations-service: ¿se puede reservar este espacio en [startAt, endAt)?
  // El solapamiento entre reservas lo valida reservations-service, dueño de las reservas.
  async function eligibility(id, { startAt }) {
    const space = await get(id);
    let reason = null;
    if (space.status === 'FUERA_DE_SERVICIO') reason = 'El espacio está fuera de servicio';
    else if (space.status === 'OCUPADO' && startAt.getTime() < now().getTime() + holdMs) {
      reason = 'El espacio está ocupado actualmente';
    }
    return { eligible: !reason, reason, space };
  }

  // Copia local de una reserva (PUT idempotente). Se descartan eventos más viejos o repetidos.
  async function syncReservation(reservationId, snap) {
    return db.transaction(async (conn) => {
      if (!(await repo.findSpace(conn, snap.spaceId))) throw spaceNotFound();
      const current = await repo.findReservation(conn, reservationId, { forUpdate: true });
      if (current && current.sourceUpdatedAt.getTime() >= snap.updatedAt.getTime()) return { applied: false };
      await repo.upsertReservation(conn, { id: reservationId, ...snap, sourceUpdatedAt: snap.updatedAt });
      return { applied: true };
    });
  }

  return { list, get, create, update, summary: async () => summarize(await list()), occupy, release, setMaintenance, eligibility, syncReservation };
}

module.exports = { createSpaceService };
