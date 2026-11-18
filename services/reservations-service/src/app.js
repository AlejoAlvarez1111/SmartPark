const express = require('express');
const { requestId, requestLogger, notFoundRoute, errorHandler, healthHandler } = require('@smartpark/shared');
const config = require('./config');
const repository = require('./repositories/reservation.repository');
const { createServicesClient } = require('./clients/services.client');
const { createOutboxDispatcher } = require('./services/outbox.dispatcher');
const { createReservationService } = require('./services/reservation.service');
const { createReservationController } = require('./controllers/reservation.controller');
const { createReservationRoutes } = require('./routes/reservation.routes');

// repo, clients y now son inyectables para probar sin MySQL ni los otros servicios
function createApp({ db, logger, repo = repository, clients = createServicesClient(config), now }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', healthHandler({ service: config.serviceName, version: config.version, ping: db.ping }));

  const dispatcher = createOutboxDispatcher({
    db,
    repo,
    clients,
    logger,
    maxAttempts: config.outboxMaxAttempts,
    intervalMs: config.outboxIntervalMs,
  });
  const service = createReservationService({ db, repo, clients, dispatcher, pastToleranceMinutes: config.pastToleranceMinutes, now });
  app.use('/api/v1/reservations', createReservationRoutes(createReservationController(service)));
  app.locals.dispatcher = dispatcher; // server.js arranca el reintento periódico
  app.locals.service = service; // las pruebas de concurrencia llaman al servicio sin pasar por HTTP

  app.use(notFoundRoute);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
