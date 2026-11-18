const { ok, parse } = require('@smartpark/shared');
const v = require('../validators/vehicle.validator');

function createVehicleController(service) {
  return {
    list: async (req, res) => ok(res, await service.list(parse(v.listQuerySchema, req.query))),

    create: async (req, res) =>
      ok(res, await service.create(parse(v.createVehicleSchema, req.body)), 'Vehículo registrado correctamente', 201),

    getById: async (req, res) => ok(res, await service.getById(parse(v.idParamSchema, req.params).id)),

    getByPlate: async (req, res) => ok(res, await service.getByPlate(parse(v.plateParamSchema, req.params).plate)),

    update: async (req, res) => {
      const { id } = parse(v.idParamSchema, req.params);
      ok(res, await service.update(id, parse(v.updateVehicleSchema, req.body)), 'Vehículo actualizado correctamente');
    },

    setStatus: async (req, res) => {
      const { id } = parse(v.idParamSchema, req.params);
      const { status } = parse(v.statusSchema, req.body);
      ok(res, await service.setStatus(id, status), status === 'ACTIVO' ? 'Vehículo activado' : 'Vehículo desactivado');
    },
  };
}

module.exports = { createVehicleController };
