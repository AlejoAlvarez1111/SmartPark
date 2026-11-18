const { ok, parse } = require('@smartpark/shared');
const v = require('../validators/event.validator');

function createEventController(service) {
  const handle = (schema, fn) => async (req, res) => {
    const result = await fn(parse(schema, req.body), res.locals.requestId);
    if (result.duplicate) return ok(res, result, 'Evento ya procesado (DUPLICATE_EVENT): no se repitió el efecto', 200);
    ok(res, result, result.event.message, 201);
  };
  return {
    entry: handle(v.entrySchema, service.entry),
    exit: handle(v.exitSchema, service.exit),
    list: async (req, res) => ok(res, await service.list(parse(v.listQuerySchema, req.query))),
  };
}

module.exports = { createEventController };
