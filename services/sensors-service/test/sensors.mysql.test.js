// Integración real contra MySQL (smartpark_sensors). Se omite si la base no responde.
const { test, after } = require('node:test');
const { runApiSuite, SENSOR } = require('./api-suite');
const db = require('../src/config/db');

(async () => {
  if (!(await db.ping())) {
    test('integración MySQL', { skip: 'MySQL no disponible: ejecuta `npm run db:setup`' }, () => {});
    after(() => db.pool.end());
    return;
  }
  runApiSuite('mysql', {
    db,
    cleanup: async () => {
      await db.pool.query('DELETE FROM sensor_events WHERE sensor_id = ?', [SENSOR]);
      await db.pool.end();
    },
  });
})();
