// Acceso a smartpark_sensors.sensor_events
const COLUMNS = `id, event_id, sensor_id, space_id, space_code, vehicle_id, plate, event_type, source, occurred_at,
  processed_at, processing_status, result_code, http_status, message, created_at`;

const toEvent = (r) =>
  r && {
    id: r.id,
    eventId: r.event_id,
    sensorId: r.sensor_id,
    eventType: r.event_type,
    spaceId: r.space_id,
    spaceCode: r.space_code,
    vehicleId: r.vehicle_id,
    plate: r.plate,
    source: r.source,
    occurredAt: r.occurred_at,
    processedAt: r.processed_at,
    status: r.processing_status,
    resultCode: r.result_code,
    httpStatus: r.http_status,
    message: r.message,
    createdAt: r.created_at,
  };

const FIELD_TO_COLUMN = {
  status: 'processing_status',
  resultCode: 'result_code',
  httpStatus: 'http_status',
  message: 'message',
  spaceCode: 'space_code',
  plate: 'plate',
  vehicleId: 'vehicle_id',
  processedAt: 'processed_at',
};

module.exports = {
  // Lanza ER_DUP_ENTRY si el eventId ya existe: es la barrera de idempotencia
  insert: (pool, e) =>
    pool.query(
      `INSERT INTO sensor_events (id, event_id, sensor_id, space_id, vehicle_id, event_type, source, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.eventId, e.sensorId, e.spaceId, e.vehicleId, e.eventType, e.source, e.occurredAt],
    ),

  async findByEventId(pool, eventId) {
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM sensor_events WHERE event_id = ?`, [eventId]);
    return toEvent(rows[0]);
  },

  // Un evento FALLIDO (dependencia caída) se puede reintentar con el mismo eventId. UPDATE condicional:
  // si dos reintentos llegan a la vez, solo uno lo reclama.
  async claimFailed(pool, eventId) {
    const [r] = await pool.query(
      "UPDATE sensor_events SET processing_status = 'PENDIENTE' WHERE event_id = ? AND processing_status = 'FALLIDO'",
      [eventId],
    );
    return r.affectedRows === 1;
  },

  finish(pool, eventId, fields) {
    const keys = Object.keys(fields);
    return pool.query(
      `UPDATE sensor_events SET ${keys.map((k) => `${FIELD_TO_COLUMN[k]} = ?`).join(', ')} WHERE event_id = ?`,
      [...keys.map((k) => fields[k]), eventId],
    );
  },

  async list(pool, { type, status, spaceId, limit }) {
    const filters = [
      ['event_type = ?', type],
      ['processing_status = ?', status],
      ['space_id = ?', spaceId],
    ].filter(([, v]) => v);
    const where = filters.length ? `WHERE ${filters.map(([s]) => s).join(' AND ')}` : '';
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM sensor_events ${where} ORDER BY created_at DESC, id LIMIT ?`, [
      ...filters.map(([, v]) => v),
      limit,
    ]);
    return rows.map(toEvent);
  },
};
