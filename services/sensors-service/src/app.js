const express = require('express');
const { requestId, requestLogger, notFoundRoute, errorHandler, healthHandler } = require('@smartpark/shared');
const config = require('./config');
const repository = require('./repositories/event.repository');
const { createServicesClient } = require('./clients/services.client');
const { createEventService } = require('./services/event.service');
const { createEventController } = require('./controllers/event.controller');
const { createEventRoutes } = require('./routes/event.routes');

// repo, clients y now son inyectables para probar sin MySQL ni los otros servicios
function createApp({ db, logger, repo = repository, clients = createServicesClient(config), now }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  const health = healthHandler({ service: config.serviceName, version: config.version, ping: db.ping });
  app.get('/health', health);
  app.get('/api/v1/sensors/health', health);

  const service = createEventService({ db, repo, clients, logger, now });
  app.use('/api/v1/sensors', createEventRoutes(createEventController(service)));
  app.locals.service = service; // pruebas de concurrencia sin pasar por HTTP

  app.use(notFoundRoute);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
