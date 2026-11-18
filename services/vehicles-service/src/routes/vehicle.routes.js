const express = require('express');

function createVehicleRoutes(controller) {
  const router = express.Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/plate/:plate', controller.getByPlate); // antes de /:id
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  router.patch('/:id/status', controller.setStatus);
  return router;
}

module.exports = { createVehicleRoutes };
