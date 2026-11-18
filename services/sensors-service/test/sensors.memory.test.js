// Sensores con un repositorio en memoria que imita el índice UNIQUE de event_id
const { runApiSuite } = require('./api-suite');

function memoryRepo() {
  const rows = new Map(); // eventId -> evento
  const copy = (x) => x && structuredClone(x);
  return {
    async insert(_p, e) {
      if (rows.has(e.eventId)) throw Object.assign(new Error('uq_sensor_event_id'), { code: 'ER_DUP_ENTRY' });
      rows.set(e.eventId, { ...e, status: 'PENDIENTE', spaceCode: null, plate: null, processedAt: null, resultCode: null, httpStatus: null, message: null, createdAt: new Date() });
    },
    findByEventId: async (_p, id) => copy(rows.get(id)),
    async claimFailed(_p, id) {
      const r = rows.get(id);
      if (r?.status !== 'FALLIDO') return false;
      r.status = 'PENDIENTE';
      return true;
    },
    async finish(_p, id, fields) {
      Object.assign(rows.get(id), fields);
    },
    list: async (_p, { type, status, spaceId, limit }) =>
      [...rows.values()]
        .filter((r) => (!type || r.eventType === type) && (!status || r.status === status) && (!spaceId || r.spaceId === spaceId))
        .reverse()
        .slice(0, limit)
        .map(copy),
  };
}

runApiSuite('memoria', { db: { pool: null, ping: async () => true }, repo: memoryRepo() });
