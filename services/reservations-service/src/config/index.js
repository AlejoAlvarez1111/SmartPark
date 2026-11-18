const { version } = require('../../package.json');

const env = process.env;

module.exports = {
  serviceName: 'reservations-service',
  version,
  port: Number(env.RESERVATIONS_PORT) || 3003,
  database: env.RESERVATIONS_DB || 'smartpark_reservations',
  vehiclesUrl: env.VEHICLES_SERVICE_URL || 'http://localhost:3001',
  spacesUrl: env.SPACES_SERVICE_URL || 'http://localhost:3002',
  pastToleranceMinutes: Number(env.RESERVATION_PAST_TOLERANCE_MINUTES ?? 5),
  outboxIntervalMs: Number(env.OUTBOX_INTERVAL_MS) || 5000,
  outboxMaxAttempts: Number(env.OUTBOX_MAX_ATTEMPTS) || 5,
};
