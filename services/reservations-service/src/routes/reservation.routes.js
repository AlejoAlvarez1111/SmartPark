const express = require('express');

function createReservationRoutes(c) {
  const router = express.Router();
  router.get('/', c.list);
  router.post('/', c.create);
  router.get('/:id', c.get);
  router.post('/:id/cancel', c.cancel);
  router.post('/:id/complete', c.complete);
  // Uso interno (sensors-service cuando entra el titular); el gateway no expone /internal
  router.post('/internal/:id/start', c.start);
  return router;
}

module.exports = { createReservationRoutes };
