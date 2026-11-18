const { ok, parse } = require('@smartpark/shared');
const v = require('../validators/space.validator');

const idOf = (req) => parse(v.idParamSchema, req.params).id;

function createSpaceController(service) {
  return {
    list: async (req, res) => ok(res, await service.list(parse(v.listQuerySchema, req.query))),
    summary: async (req, res) => ok(res, await service.summary()),
    get: async (req, res) => ok(res, await service.get(idOf(req))),
    create: async (req, res) => ok(res, await service.create(parse(v.createSpaceSchema, req.body)), 'Espacio creado correctamente', 201),
    update: async (req, res) => ok(res, await service.update(idOf(req), parse(v.updateSpaceSchema, req.body)), 'Espacio actualizado correctamente'),

    occupy: async (req, res) => {
      const result = await service.occupy({ id: idOf(req), ...parse(v.occupySchema, req.body) });
      ok(res, result, result.duplicate ? 'Evento ya procesado: no se repite la ocupación' : 'Ocupación registrada');
    },

    release: async (req, res) => {
      const result = await service.release({ id: idOf(req), ...parse(v.releaseSchema, req.body) });
      ok(res, result, result.duplicate ? 'Evento ya procesado: no se repite la liberación' : 'Espacio liberado');
    },

    maintenance: async (req, res) => {
      const { outOfService } = parse(v.maintenanceSchema, req.body);
      ok(res, await service.setMaintenance({ id: idOf(req), outOfService }), outOfService ? 'Espacio fuera de servicio' : 'Espacio habilitado');
    },

    eligibility: async (req, res) => ok(res, await service.eligibility(idOf(req), parse(v.eligibilityQuerySchema, req.query))),

    syncReservation: async (req, res) => {
      const { reservationId } = parse(v.reservationParamSchema, req.params);
      const result = await service.syncReservation(reservationId, parse(v.reservationSnapshotSchema, req.body));
      ok(res, result, result.applied ? 'Reserva sincronizada' : 'Evento de reserva ignorado (más antiguo o repetido)');
    },
  };
}

module.exports = { createSpaceController };
