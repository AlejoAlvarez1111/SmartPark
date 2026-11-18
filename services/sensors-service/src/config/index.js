const { version } = require('../../package.json');

module.exports = {
  serviceName: 'sensors-service',
  version,
  port: Number(process.env.SENSORS_PORT) || 3004,
  database: process.env.SENSORS_DB || 'smartpark_sensors',
};
