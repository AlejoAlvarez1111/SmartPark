const express = require('express');

function createSpaceRoutes(c) {
  const router = express.Router();
  router.get('/', c.list);
  router.post('/', c.create);
  router.get('/summary', c.summary); // antes de /:id
  router.get('/:id', c.get);
  router.patch('/:id', c.update);
  router.post('/:id/occupy', c.occupy);
  router.post('/:id/release', c.release);
  router.patch('/:id/maintenance', c.maintenance);
  // Uso interno de reservations-service (el gateway no expone /internal)
  router.get('/:id/eligibility', c.eligibility);
  router.put('/internal/reservations/:reservationId', c.syncReservation);
  return router;
}

module.exports = { createSpaceRoutes };
