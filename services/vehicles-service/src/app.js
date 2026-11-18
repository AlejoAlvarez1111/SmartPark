const express = require('express');
const { requestId, requestLogger, notFoundRoute, errorHandler, healthHandler } = require('@smartpark/shared');
const config = require('./config');
const { createVehicleRepository } = require('./repositories/vehicle.repository');
const { createVehicleService } = require('./services/vehicle.service');
const { createVehicleController } = require('./controllers/vehicle.controller');
const { createVehicleRoutes } = require('./routes/vehicle.routes');

// repo es inyectable para probar la capa HTTP sin MySQL
function createApp({ db, logger, repo = createVehicleRepository(db.pool) }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', healthHandler({ service: config.serviceName, version: config.version, ping: db.ping }));
  app.use('/api/v1/vehicles', createVehicleRoutes(createVehicleController(createVehicleService(repo))));

  app.use(notFoundRoute);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
