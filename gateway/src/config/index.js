const { version } = require('../../package.json');

const env = process.env;

module.exports = {
  serviceName: 'gateway',
  version,
  port: Number(env.GATEWAY_PORT) || 3000,
  timeoutMs: Number(env.SERVICE_TIMEOUT_MS) || 3000,
  frontendOrigin: env.FRONTEND_ORIGIN || 'http://localhost:5500',
  // clave = primer segmento después de /api/v1
  services: {
    vehicles: { name: 'vehicles-service', url: env.VEHICLES_SERVICE_URL || 'http://localhost:3001' },
    spaces: { name: 'spaces-service', url: env.SPACES_SERVICE_URL || 'http://localhost:3002' },
    reservations: { name: 'reservations-service', url: env.RESERVATIONS_SERVICE_URL || 'http://localhost:3003' },
    sensors: { name: 'sensors-service', url: env.SENSORS_SERVICE_URL || 'http://localhost:3004' },
  },
};
