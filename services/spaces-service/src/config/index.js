const { version } = require('../../package.json');

module.exports = {
  serviceName: 'spaces-service',
  version,
  port: Number(process.env.SPACES_PORT) || 3002,
  database: process.env.SPACES_DB || 'smartpark_spaces',
  holdMinutes: Number(process.env.RESERVATION_HOLD_MINUTES ?? 60),
};
