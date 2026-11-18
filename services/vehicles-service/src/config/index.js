const { version } = require('../../package.json');

module.exports = {
  serviceName: 'vehicles-service',
  version,
  port: Number(process.env.VEHICLES_PORT) || 3001,
  database: process.env.VEHICLES_DB || 'smartpark_vehicles',
};
