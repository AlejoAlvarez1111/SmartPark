const express = require('express');
const { requestId, requestLogger, notFoundRoute, errorHandler, healthHandler } = require('@smartpark/shared');
const config = require('./config');
const repository = require('./repositories/space.repository');
const { createSpaceService } = require('./services/space.service');
const { createSpaceController } = require('./controllers/space.controller');
const { createSpaceRoutes } = require('./routes/space.routes');

// repo y now son inyectables para probar las reglas sin MySQL
function createApp({ db, logger, repo = repository, now }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', healthHandler({ service: config.serviceName, version: config.version, ping: db.ping }));
  const service = createSpaceService({ db, repo, holdMinutes: config.holdMinutes, now });
  app.use('/api/v1/spaces', createSpaceRoutes(createSpaceController(service)));

  app.use(notFoundRoute);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
