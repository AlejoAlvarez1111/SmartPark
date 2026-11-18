const express = require('express');
const { requestId, requestLogger, notFoundRoute, errorHandler, healthHandler } = require('@smartpark/shared');
const config = require('./config');

function createApp({ db, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  const health = healthHandler({ service: config.serviceName, version: config.version, ping: db.ping });
  app.get('/health', health);
  app.get('/api/v1/sensors/health', health);

  app.use(notFoundRoute);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
