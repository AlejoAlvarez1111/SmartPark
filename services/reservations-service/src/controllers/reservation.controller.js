const { ok, parse } = require('@smartpark/shared');
const v = require('../validators/reservation.validator');

const idOf = (req) => parse(v.idParamSchema, req.params).id;
const rid = (res) => res.locals.requestId;

function createReservationController(service) {
  const action = (fn, message) => async (req, res) => ok(res, await fn(idOf(req), rid(res)), message);
  return {
    list: async (req, res) => ok(res, await service.list(parse(v.listQuerySchema, req.query))),
    get: async (req, res) => ok(res, await service.get(idOf(req))),
    create: async (req, res) =>
      ok(res, await service.create(parse(v.createReservationSchema, req.body), rid(res)), 'Reserva confirmada', 201),
    cancel: action(service.cancel, 'Reserva cancelada'),
    complete: action(service.complete, 'Reserva completada'),
    start: action(service.start, 'Reserva en curso'),
  };
}

module.exports = { createReservationController };
