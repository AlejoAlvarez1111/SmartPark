// Integración real contra MySQL (smartpark_vehicles). Se omite si la base no responde.
const { test, after } = require('node:test');
const { runApiSuite, PREFIX } = require('./api-suite');
const db = require('../src/config/db');

(async () => {
  if (!(await db.ping())) {
    test('integración MySQL', { skip: 'MySQL no disponible: ejecuta `npm run db:setup` o `docker compose up -d mysql db-setup`' }, () => {});
    after(() => db.pool.end());
    return;
  }
  runApiSuite('mysql', {
    db,
    cleanup: async () => {
      await db.pool.query('DELETE FROM vehicles WHERE plate LIKE ?', [`${PREFIX}%`]);
      await db.pool.end();
    },
  });
})();
