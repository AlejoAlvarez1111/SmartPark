// Acceso a smartpark_spaces. Cada función recibe `conn`: el pool o la conexión de una transacción.

const SPACE_SELECT = `
  SELECT s.id, s.code, s.zone, s.space_type, s.status, s.created_at, s.updated_at,
         o.id AS occ_id, o.vehicle_id AS occ_vehicle_id, o.entry_at AS occ_entry_at, o.reservation_id AS occ_reservation_id
  FROM parking_spaces s
  LEFT JOIN occupancies o ON o.open_space_id = s.id`;

const toSpace = (r) =>
  r && {
    id: r.id,
    code: r.code,
    zone: r.zone,
    spaceType: r.space_type,
    status: r.status, // estado operativo guardado
    occupancy: r.occ_id ? { id: r.occ_id, vehicleId: r.occ_vehicle_id, entryAt: r.occ_entry_at, reservationId: r.occ_reservation_id } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

const toOccupancy = (r) =>
  r && {
    id: r.id,
    spaceId: r.space_id,
    vehicleId: r.vehicle_id,
    reservationId: r.reservation_id,
    entryAt: r.entry_at,
    exitAt: r.exit_at,
    sourceEventId: r.source_event_id,
    exitEventId: r.exit_event_id,
    status: r.status,
  };

const toReservation = (r) =>
  r && {
    id: r.reservation_id,
    spaceId: r.space_id,
    vehicleId: r.vehicle_id,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    sourceUpdatedAt: r.source_updated_at,
  };

const SPACE_COLUMNS = { code: 'code', zone: 'zone', spaceType: 'space_type' };
const OCC_COLUMNS = 'id, space_id, vehicle_id, reservation_id, entry_at, exit_at, source_event_id, exit_event_id, status';

const one = async (conn, sql, params, map) => map((await conn.query(sql, params))[0][0]);

module.exports = {
  async listSpaces(conn, { id, type, zone } = {}) {
    const filters = [
      ['s.id = ?', id],
      ['s.space_type = ?', type],
      ['s.zone = ?', zone],
    ].filter(([, v]) => v);
    const where = filters.length ? `WHERE ${filters.map(([sql]) => sql).join(' AND ')}` : '';
    const [rows] = await conn.query(`${SPACE_SELECT} ${where} ORDER BY s.code`, filters.map(([, v]) => v));
    return rows.map(toSpace);
  },

  // Fila del espacio sola; con forUpdate la bloquea hasta el fin de la transacción
  findSpace: (conn, id, { forUpdate = false } = {}) =>
    one(conn, `SELECT id, code, zone, space_type, status, created_at, updated_at FROM parking_spaces WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id], toSpace),

  insertSpace: (conn, s) =>
    conn.query('INSERT INTO parking_spaces (id, code, zone, space_type) VALUES (?, ?, ?, ?)', [s.id, s.code, s.zone, s.spaceType]),

  updateSpace(conn, id, fields) {
    const sets = Object.keys(fields).map((f) => `${SPACE_COLUMNS[f]} = ?`);
    return conn.query(`UPDATE parking_spaces SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(fields), id]);
  },

  // UPDATE condicional (§6.5): solo cambia si el estado actual es `from`. Devuelve true si cambió.
  async setSpaceStatus(conn, id, from, to) {
    const [r] = await conn.query('UPDATE parking_spaces SET status = ? WHERE id = ? AND status = ?', [to, id, from]);
    return r.affectedRows === 1;
  },

  // Próxima reserva CONFIRMADA no terminada de cada espacio: Map(spaceId -> reserva)
  async nextReservationsBySpace(conn, now, spaceId) {
    const [rows] = await conn.query(
      `SELECT reservation_id, space_id, vehicle_id, start_at, end_at, status, source_updated_at
       FROM space_reservations WHERE status = 'CONFIRMADA' AND end_at > ?${spaceId ? ' AND space_id = ?' : ''}
       ORDER BY start_at`,
      spaceId ? [now, spaceId] : [now],
    );
    const map = new Map();
    for (const r of rows) if (!map.has(r.space_id)) map.set(r.space_id, toReservation(r));
    return map;
  },

  async countActiveReservations(conn, spaceId, now) {
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM space_reservations WHERE space_id = ? AND status IN ('CONFIRMADA','EN_CURSO') AND end_at > ?`,
      [spaceId, now],
    );
    return Number(n);
  },

  findOccupancyBySourceEvent: (conn, eventId) => one(conn, `SELECT ${OCC_COLUMNS} FROM occupancies WHERE source_event_id = ?`, [eventId], toOccupancy),
  findOccupancyByExitEvent: (conn, eventId, { forUpdate = false } = {}) =>
    one(conn, `SELECT ${OCC_COLUMNS} FROM occupancies WHERE exit_event_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [eventId], toOccupancy),
  // forUpdate: lectura bloqueante, ve el último dato confirmado aunque la transacción empezara antes
  findOpenOccupancyBySpace: (conn, spaceId, { forUpdate = false } = {}) =>
    one(conn, `SELECT ${OCC_COLUMNS} FROM occupancies WHERE open_space_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [spaceId], toOccupancy),
  findOpenOccupancyByVehicle: (conn, vehicleId) => one(conn, `SELECT ${OCC_COLUMNS} FROM occupancies WHERE open_vehicle_id = ?`, [vehicleId], toOccupancy),

  insertOccupancy: (conn, o) =>
    conn.query(
      'INSERT INTO occupancies (id, space_id, vehicle_id, reservation_id, entry_at, source_event_id) VALUES (?, ?, ?, ?, ?, ?)',
      [o.id, o.spaceId, o.vehicleId, o.reservationId, o.entryAt, o.sourceEventId],
    ),

  closeOccupancy: (conn, id, exitAt, exitEventId) =>
    conn.query("UPDATE occupancies SET status = 'CERRADA', exit_at = ?, exit_event_id = ? WHERE id = ? AND status = 'ABIERTA'", [exitAt, exitEventId, id]),

  findReservation: (conn, id, { forUpdate = false } = {}) =>
    one(conn, `SELECT reservation_id, space_id, vehicle_id, start_at, end_at, status, source_updated_at FROM space_reservations WHERE reservation_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id], toReservation),

  upsertReservation: (conn, r) =>
    conn.query(
      `INSERT INTO space_reservations (reservation_id, space_id, vehicle_id, start_at, end_at, status, source_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE space_id = VALUES(space_id), vehicle_id = VALUES(vehicle_id), start_at = VALUES(start_at),
         end_at = VALUES(end_at), status = VALUES(status), source_updated_at = VALUES(source_updated_at)`,
      [r.id, r.spaceId, r.vehicleId, r.startAt, r.endAt, r.status, r.sourceUpdatedAt],
    ),

  setReservationStatus: (conn, id, status) => conn.query('UPDATE space_reservations SET status = ? WHERE reservation_id = ?', [status, id]),
};
