// API de vehículos con un repositorio en memoria que imita el índice UNIQUE de MySQL
const { runApiSuite } = require('./api-suite');

function memoryRepo() {
  const rows = new Map();
  const dup = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
  const plateTaken = (plate, exceptId) => [...rows.values()].some((r) => r.plate === plate && r.id !== exceptId);
  return {
    findById: async (id) => rows.get(id),
    findByPlate: async (plate) => [...rows.values()].find((r) => r.plate === plate),
    async list({ search, status, vehicleType, limit, offset }) {
      const items = [...rows.values()]
        .filter((r) => (!search || r.plate.includes(search)) && (!status || r.status === status) && (!vehicleType || r.vehicleType === vehicleType))
        .sort((a, b) => a.plate.localeCompare(b.plate));
      return { items: items.slice(offset, offset + limit), total: items.length };
    },
    async insert(v) {
      if (plateTaken(v.plate)) throw dup();
      const now = new Date();
      rows.set(v.id, { ...v, status: 'ACTIVO', createdAt: now, updatedAt: now });
      return rows.get(v.id);
    },
    async update(id, fields) {
      if (!rows.has(id)) return undefined;
      if (fields.plate && plateTaken(fields.plate, id)) throw dup();
      Object.assign(rows.get(id), fields, { updatedAt: new Date() });
      return rows.get(id);
    },
  };
}

runApiSuite('memoria', { db: { ping: async () => true }, repo: memoryRepo() });
