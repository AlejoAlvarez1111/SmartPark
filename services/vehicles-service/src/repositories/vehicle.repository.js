// Acceso a smartpark_vehicles.vehicles. Solo consultas parametrizadas.
const COLUMNS = 'id, plate, vehicle_type, brand, color, status, created_at, updated_at';

const toVehicle = (row) =>
  row && {
    id: row.id,
    plate: row.plate,
    vehicleType: row.vehicle_type,
    brand: row.brand,
    color: row.color,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const FIELD_TO_COLUMN = { plate: 'plate', vehicleType: 'vehicle_type', brand: 'brand', color: 'color', status: 'status' };

function createVehicleRepository(pool) {
  const findById = async (id) => {
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM vehicles WHERE id = ?`, [id]);
    return toVehicle(rows[0]);
  };

  return {
    findById,

    async findByPlate(plate) {
      const [rows] = await pool.query(`SELECT ${COLUMNS} FROM vehicles WHERE plate = ?`, [plate]);
      return toVehicle(rows[0]);
    },

    async list({ search, status, vehicleType, limit, offset }) {
      // search ya viene validado como alfanumérico: no hay comodines LIKE que escapar
      const filters = [
        ['plate LIKE ?', search && `%${search}%`],
        ['status = ?', status],
        ['vehicle_type = ?', vehicleType],
      ].filter(([, value]) => value);
      const where = filters.map(([sql]) => sql);
      const params = filters.map(([, value]) => value);
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const [rows] = await pool.query(`SELECT ${COLUMNS} FROM vehicles ${whereSql} ORDER BY plate LIMIT ? OFFSET ?`, [...params, limit, offset]);
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM vehicles ${whereSql}`, params);
      return { items: rows.map(toVehicle), total: Number(total) };
    },

    async insert(vehicle) {
      await pool.query(
        'INSERT INTO vehicles (id, plate, vehicle_type, brand, color) VALUES (?, ?, ?, ?, ?)',
        [vehicle.id, vehicle.plate, vehicle.vehicleType, vehicle.brand, vehicle.color],
      );
      return findById(vehicle.id);
    },

    // Devuelve el vehículo actualizado, o undefined si no existe
    async update(id, fields) {
      const sets = Object.keys(fields).map((f) => `${FIELD_TO_COLUMN[f]} = ?`);
      // Se relee la fila: affectedRows puede ser 0 si los valores no cambian aunque el vehículo exista
      await pool.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(fields), id]);
      return findById(id);
    },
  };
}

module.exports = { createVehicleRepository };
