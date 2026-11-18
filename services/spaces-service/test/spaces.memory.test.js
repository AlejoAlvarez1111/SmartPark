// Reglas de espacios con un repositorio en memoria que imita los índices únicos de MySQL.
// No prueba concurrencia real: eso lo cubre spaces.mysql.test.js.
const { runApiSuite } = require('./api-suite');

function memoryRepo() {
  const spaces = new Map();
  const occs = new Map();
  const reservations = new Map();
  const dup = (key) => Object.assign(new Error(`Duplicate entry for key '${key}'`), { code: 'ER_DUP_ENTRY' });
  const find = (pred) => [...occs.values()].find(pred);
  const openOf = (spaceId) => find((o) => o.spaceId === spaceId && o.status === 'ABIERTA');
  const copy = (x) => x && structuredClone(x);

  return {
    async listSpaces(_c, { id, type, zone } = {}) {
      return [...spaces.values()]
        .filter((s) => (!id || s.id === id) && (!type || s.spaceType === type) && (!zone || s.zone === zone))
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((s) => {
          const o = openOf(s.id);
          return { ...copy(s), occupancy: o ? { id: o.id, vehicleId: o.vehicleId, entryAt: o.entryAt, reservationId: o.reservationId } : null };
        });
    },
    findSpace: async (_c, id) => copy(spaces.get(id)),
    async insertSpace(_c, s) {
      if ([...spaces.values()].some((x) => x.code === s.code)) throw dup('uq_spaces_code');
      spaces.set(s.id, { ...s, status: 'DISPONIBLE', createdAt: new Date(), updatedAt: new Date() });
    },
    async updateSpace(_c, id, fields) {
      if (fields.code && [...spaces.values()].some((x) => x.code === fields.code && x.id !== id)) throw dup('uq_spaces_code');
      Object.assign(spaces.get(id), fields);
    },
    async setSpaceStatus(_c, id, from, to) {
      const s = spaces.get(id);
      if (s.status !== from) return false;
      s.status = to;
      return true;
    },
    async nextReservationsBySpace(_c, now, spaceId) {
      const map = new Map();
      [...reservations.values()]
        .filter((r) => r.status === 'CONFIRMADA' && r.endAt > now && (!spaceId || r.spaceId === spaceId))
        .sort((a, b) => a.startAt - b.startAt)
        .forEach((r) => map.has(r.spaceId) || map.set(r.spaceId, copy(r)));
      return map;
    },
    countActiveReservations: async (_c, spaceId, now) =>
      [...reservations.values()].filter((r) => r.spaceId === spaceId && ['CONFIRMADA', 'EN_CURSO'].includes(r.status) && r.endAt > now).length,
    findOccupancyBySourceEvent: async (_c, e) => copy(find((o) => o.sourceEventId === e)),
    findOccupancyByExitEvent: async (_c, e) => copy(find((o) => o.exitEventId === e)),
    findOpenOccupancyBySpace: async (_c, spaceId) => copy(openOf(spaceId)),
    findOpenOccupancyByVehicle: async (_c, v) => copy(find((o) => o.vehicleId === v && o.status === 'ABIERTA')),
    async insertOccupancy(_c, o) {
      if (find((x) => x.sourceEventId === o.sourceEventId)) throw dup('uq_occ_source_event');
      if (openOf(o.spaceId)) throw dup('uq_occ_open_space');
      if (find((x) => x.vehicleId === o.vehicleId && x.status === 'ABIERTA')) throw dup('uq_occ_open_vehicle');
      occs.set(o.id, copy(o));
    },
    async closeOccupancy(_c, id, exitAt, exitEventId) {
      Object.assign(occs.get(id), { status: 'CERRADA', exitAt, exitEventId });
    },
    findReservation: async (_c, id) => copy(reservations.get(id)),
    async upsertReservation(_c, r) {
      reservations.set(r.id, copy(r));
    },
    async setReservationStatus(_c, id, status) {
      reservations.get(id).status = status;
    },
  };
}

runApiSuite('memoria', {
  db: { pool: null, ping: async () => true, transaction: (fn) => fn(null) },
  repo: memoryRepo(),
});
