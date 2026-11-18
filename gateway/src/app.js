const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { requestId, requestLogger, notFoundRoute, errorHandler } = require('@smartpark/shared');
const { createProxy } = require('./routes/proxy');
const { createHealth } = require('./routes/health');
const { createDashboard } = require('./routes/dashboard');

function createApp({ config, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.frontendOrigin, exposedHeaders: ['X-Request-ID'] }));
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  const health = createHealth(config);
  app.get('/health', health);
  app.get('/api/v1/health', health);
  app.get('/api/v1/dashboard', createDashboard(config));
  app.use('/api/v1', createProxy(config));
  app.use('/api', notFoundRoute);

  // Frontend estático servido por el gateway: mismo origen, sin problemas de CORS
  app.use(express.static(path.resolve(__dirname, '../../frontend')));

  app.use(notFoundRoute);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
