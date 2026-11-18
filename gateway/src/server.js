const { createLogger } = require('@smartpark/shared');
const config = require('./config');
const { createApp } = require('./app');

const logger = createLogger(config.serviceName);
const server = createApp({ config, logger }).listen(config.port, () =>
  logger.info(`Gateway escuchando en http://localhost:${config.port}`),
);

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
