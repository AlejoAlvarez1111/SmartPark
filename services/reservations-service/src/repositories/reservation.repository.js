// Acceso a smartpark_reservations. Cada función recibe `conn`: el pool o la conexión de una transacción.
const { errors } = require('@smartpark/shared');

const COLUMNS = 'id, reservation_code, vehicle_id, space_id, plate, space_code, start_at, end_at, status, created_at, updated_at, cancelled_at';
const ACTIVE = "('CONFIRMADA','EN_CURSO')";

const toReservation = (r) =>
  r && {
    id: r.id,
    code: r.reservation_code,
    vehicleId: r.vehicle_id,
    plate: r.plate,
    spaceId: r.space_id,
    spaceCode: r.space_code,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: r.cancelled_at,
  };

const toOutbox = (r) =>
  r && {
    id: r.id,
    eventType: r.event_type,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    status: r.status,
    attempts: r.attempts,
  };

module.exports = {
  /**
   * Ejecuta fn(conn) en una transacción con un bloqueo con nombre por espacio (GET_LOCK).
   * Serializa las reservas del mismo espacio: la segunda ve la reserva confirmada por la primera.
   */
  async withSpaceLock(pool, spaceId, fn) {
    const lock = `smartpark_res_space_${spaceId}`;
    const conn = await pool.getConnection();
    try {
      const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 5) AS got', [lock]);
      if (got !== 1) throw errors.unavailable('El espacio está siendo reservado por otra solicitud; intente de nuevo');
      try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        await conn.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
      }
    } finally {
      conn.release();
    }
  },

  // Reservas activas que se solapan con [startAt, endAt) en el mismo espacio o del mismo vehículo
  async findConflicts(conn, { spaceId, vehicleId, startAt, endAt }) {
    const [rows] = await conn.query(
      `SELECT ${COLUMNS} FROM reservations
       WHERE status IN ${ACTIVE} AND start_at < ? AND end_at > ? AND (space_id = ? OR vehicle_id = ?)
       ORDER BY start_at`,
      [endAt, startAt, spaceId, vehicleId],
    );
    return rows.map(toReservation);
  },

  insert: (conn, r) =>
    conn.query(
      `INSERT INTO reservations (id, reservation_code, vehicle_id, space_id, plate, space_code, start_at, end_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.code, r.vehicleId, r.spaceId, r.plate, r.spaceCode, r.startAt, r.endAt],
    ),

  async findById(conn, id, { forUpdate = false } = {}) {
    const [rows] = await conn.query(`SELECT ${COLUMNS} FROM reservations WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    return toReservation(rows[0]);
  },

  // updated_at siempre avanza (al menos 1 ms): spaces-service usa este valor para ordenar los eventos
  updateStatus: (conn, id, status) =>
    conn.query(
      `UPDATE reservations SET status = ?,
         cancelled_at = IF(? = 'CANCELADA', CURRENT_TIMESTAMP(3), cancelled_at),
         updated_at = GREATEST(CURRENT_TIMESTAMP(3), updated_at + INTERVAL 1000 MICROSECOND)
       WHERE id = ?`,
      [status, status, id],
    ),

  async list(conn, { status, plate, spaceId, vehicleId, from, to, limit, offset }) {
    const filters = [
      ['status = ?', status],
      ['plate = ?', plate],
      ['space_id = ?', spaceId],
      ['vehicle_id = ?', vehicleId],
      ['end_at > ?', from], // se solapa con [from, to)
      ['start_at < ?', to],
    ].filter(([, v]) => v);
    const where = filters.length ? `WHERE ${filters.map(([sql]) => sql).join(' AND ')}` : '';
    const params = filters.map(([, v]) => v);
    const [rows] = await conn.query(`SELECT ${COLUMNS} FROM reservations ${where} ORDER BY start_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM reservations ${where}`, params);
    return { items: rows.map(toReservation), total: Number(total) };
  },

  async insertOutbox(conn, eventType, payload) {
    const [r] = await conn.query('INSERT INTO outbox_events (event_type, payload) VALUES (?, ?)', [eventType, JSON.stringify(payload)]);
    return r.insertId;
  },

  async findOutbox(conn, id) {
    const [rows] = await conn.query('SELECT id, event_type, payload, status, attempts FROM outbox_events WHERE id = ?', [id]);
    return toOutbox(rows[0]);
  },

  async pendingOutbox(conn, limit) {
    const [rows] = await conn.query("SELECT id, event_type, payload, status, attempts FROM outbox_events WHERE status = 'PENDIENTE' ORDER BY id LIMIT ?", [limit]);
    return rows.map(toOutbox);
  },

  markOutbox: (conn, id, { status, attempts, lastError = null }) =>
    conn.query('UPDATE outbox_events SET status = ?, attempts = ?, last_error = ? WHERE id = ?', [status, attempts, lastError?.slice(0, 255) ?? null, id]),
};
