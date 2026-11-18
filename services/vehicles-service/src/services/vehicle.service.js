const { randomUUID } = require('node:crypto');
const { errors } = require('@smartpark/shared');

const notFound = () => errors.notFound('VEHICLE_NOT_FOUND', 'El vehículo no existe');
const duplicatePlate = (plate) =>
  errors.conflict('VEHICLE_ALREADY_EXISTS', `Ya existe un vehículo con la placa ${plate}`);

// La unicidad de la placa la garantiza el índice UNIQUE: así no hay carrera entre "consultar" e "insertar"
const isDuplicate = (err) => err.code === 'ER_DUP_ENTRY';

function createVehicleService(repo) {
  return {
    list: (query) => repo.list(query),

    async getById(id) {
      return (await repo.findById(id)) ?? Promise.reject(notFound());
    },

    async getByPlate(plate) {
      return (await repo.findByPlate(plate)) ?? Promise.reject(notFound());
    },

    async create(data) {
      try {
        return await repo.insert({ id: randomUUID(), ...data });
      } catch (err) {
        throw isDuplicate(err) ? duplicatePlate(data.plate) : err;
      }
    },

    async update(id, fields) {
      try {
        return (await repo.update(id, fields)) ?? Promise.reject(notFound());
      } catch (err) {
        throw isDuplicate(err) ? duplicatePlate(fields.plate) : err;
      }
    },

    // Sin borrado físico: el vehículo puede estar en historiales de otros servicios (§7.1)
    async setStatus(id, status) {
      return (await repo.update(id, { status })) ?? Promise.reject(notFound());
    },
  };
}

module.exports = { createVehicleService };
