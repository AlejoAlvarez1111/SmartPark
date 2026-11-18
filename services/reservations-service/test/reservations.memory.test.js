// Reservas con un repositorio en memoria. withSpaceLock serializa por espacio como lo hace GET_LOCK en MySQL.
const { runApiSuite } = require('./api-suite');
const { overlaps } = require('../src/services/reservation.rules');

function memoryRepo() {
  const rows = new Map();
  const outbox = new Map();
  const locks = new Map();
  let outboxSeq = 0;
  const copy = (x) => x && structuredClone(x);

  return {
    async withSpaceLock(_pool, spaceId, fn) {
      const prev = locks.get(spaceId) ?? Promise.resolve();
      let release;
      const mine = new Promise((r) => (release = r));
      locks.set(spaceId, prev.then(() => mine));
      await prev;
      try {
        return await fn(null);
      } finally {
        release();
      }
    },
    // Lee y luego espera (latencia de red de la consulta): abre la ventana entre leer e insertar
    // en la que se cuelan las reservas concurrentes si withSpaceLock no serializa
    async findConflicts(_c, q) {
      const found = [...rows.values()]
        .filter((r) => ['CONFIRMADA', 'EN_CURSO'].includes(r.status) && overlaps(r, q) && (r.spaceId === q.spaceId || r.vehicleId === q.vehicleId))
        .map(copy);
      await new Promise((r) => setTimeout(r, 5));
      return found;
    },
    async insert(_c, r) {
      if ([...rows.values()].some((x) => x.code === r.code)) throw Object.assign(new Error('uq_res_code'), { code: 'ER_DUP_ENTRY' });
      const t = new Date();
      rows.set(r.id, { ...r, status: 'CONFIRMADA', createdAt: t, updatedAt: t, cancelledAt: null });
    },
    findById: async (_c, id) => copy(rows.get(id)),
    async updateStatus(_c, id, status) {
      const r = rows.get(id);
      r.updatedAt = new Date(Math.max(Date.now(), r.updatedAt.getTime() + 1));
      if (status === 'CANCELADA') r.cancelledAt = new Date();
      r.status = status;
    },
    async list(_c, { status, plate, spaceId, vehicleId, from, to, limit, offset }) {
      const items = [...rows.values()]
        .filter(
          (r) =>
            (!status || r.status === status) &&
            (!plate || r.plate === plate) &&
            (!spaceId || r.spaceId === spaceId) &&
            (!vehicleId || r.vehicleId === vehicleId) &&
            (!from || r.endAt > from) &&
            (!to || r.startAt < to),
        )
        .sort((a, b) => b.startAt - a.startAt);
      return { items: items.slice(offset, offset + limit).map(copy), total: items.length };
    },
    async insertOutbox(_c, eventType, payload) {
      const id = ++outboxSeq;
      outbox.set(id, { id, eventType, payload: copy(payload), status: 'PENDIENTE', attempts: 0 });
      return id;
    },
    findOutbox: async (_c, id) => copy(outbox.get(id)),
    pendingOutbox: async (_c, limit) => [...outbox.values()].filter((e) => e.status === 'PENDIENTE').slice(0, limit).map(copy),
    async markOutbox(_c, id, { status, attempts }) {
      Object.assign(outbox.get(id), { status, attempts });
    },
  };
}

runApiSuite('memoria', {
  db: { pool: null, ping: async () => true, transaction: (fn) => fn(null) },
  repo: memoryRepo(),
});
