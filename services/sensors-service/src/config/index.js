const { version } = require('../../package.json');

const env = process.env;

module.exports = {
  serviceName: 'sensors-service',
  version,
  port: Number(env.SENSORS_PORT) || 3004,
  database: env.SENSORS_DB || 'smartpark_sensors',
  vehiclesUrl: env.VEHICLES_SERVICE_URL || 'http://localhost:3001',
  spacesUrl: env.SPACES_SERVICE_URL || 'http://localhost:3002',
  reservationsUrl: env.RESERVATIONS_SERVICE_URL || 'http://localhost:3003',
};
