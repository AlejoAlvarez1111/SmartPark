// Integración real contra MySQL (smartpark_reservations), incluida la concurrencia de la suite. Se omite sin BD.
const { test, after } = require('node:test');
const { runApiSuite } = require('./api-suite');
const db = require('../src/config/db');

(async () => {
  if (!(await db.ping())) {
    test('integración MySQL', { skip: 'MySQL no disponible: ejecuta `npm run db:setup` o `docker compose up -d mysql db-setup`' }, () => {});
    after(() => db.pool.end());
    return;
  }
  const createdIds = [];
  runApiSuite('mysql', {
    db,
    createdIds,
    cleanup: async () => {
      if (createdIds.length) {
        await db.pool.query("DELETE FROM outbox_events WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.reservationId')) IN (?)", [createdIds]);
        await db.pool.query('DELETE FROM reservations WHERE id IN (?)', [createdIds]);
      }
      await db.pool.end();
    },
  });
})();
