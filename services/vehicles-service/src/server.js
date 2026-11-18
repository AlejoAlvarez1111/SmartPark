const { createLogger } = require('@smartpark/shared');
const config = require('./config');
const db = require('./config/db');
const { createApp } = require('./app');

const logger = createLogger(config.serviceName);
const server = createApp({ db, logger }).listen(config.port, async () => {
  logger.info(`Escuchando en el puerto ${config.port}`);
  if (!(await db.ping())) logger.warn(`Sin conexión a MySQL (base ${config.database}); /health responderá DEGRADED`);
});

const shutdown = () => server.close(() => db.pool.end().finally(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
