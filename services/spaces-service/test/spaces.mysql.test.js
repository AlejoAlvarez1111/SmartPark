// Integración real contra MySQL (smartpark_spaces) + prueba de concurrencia §14.4. Se omite si la base no responde.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { runApiSuite, ZONE } = require('./api-suite');
const db = require('../src/config/db');
const repo = require('../src/repositories/space.repository');
const { createSpaceService } = require('../src/services/space.service');

const cleanup = async () => {
  const [rows] = await db.pool.query('SELECT id FROM parking_spaces WHERE zone = ?', [ZONE]);
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.pool.query('DELETE FROM occupancies WHERE space_id IN (?)', [ids]);
    await db.pool.query('DELETE FROM space_reservations WHERE space_id IN (?)', [ids]);
    await db.pool.query('DELETE FROM parking_spaces WHERE id IN (?)', [ids]);
  }
};

(async () => {
  if (!(await db.ping())) {
    test('integración MySQL', { skip: 'MySQL no disponible: ejecuta `npm run db:setup` o `docker compose up -d mysql db-setup`' }, () => {});
    after(() => db.pool.end());
    return;
  }

  runApiSuite('mysql', { db });

  test('[mysql] concurrencia: 10 entradas simultáneas al mismo espacio -> 1 éxito, 9 rechazos (§14.4)', async () => {
    const service = createSpaceService({ db, repo, holdMinutes: 60 });
    const space = await service.create({ code: `ZC-${Date.now() % 100000}`, zone: ZONE, spaceType: 'ESTANDAR' });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.occupy({ id: space.id, vehicleId: randomUUID(), eventId: randomUUID() })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.ok(rejected.every((r) => r.reason.status === 409), rejected.map((r) => r.reason.message).join('; '));

    const [[{ open }]] = await db.pool.query("SELECT COUNT(*) AS open FROM occupancies WHERE space_id = ? AND status = 'ABIERTA'", [space.id]);
    assert.equal(Number(open), 1);
  });

  test('[mysql] concurrencia: el mismo evento entregado 5 veces a la vez -> una sola ocupación', async () => {
    const service = createSpaceService({ db, repo, holdMinutes: 60 });
    const space = await service.create({ code: `ZD-${Date.now() % 100000}`, zone: ZONE, spaceType: 'ESTANDAR' });
    const vehicleId = randomUUID();
    const eventId = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.occupy({ id: space.id, vehicleId, eventId })));
    assert.ok(results.every((r) => r.status === 'fulfilled'), results.map((r) => r.reason?.message).join('; '));
    assert.equal(results.filter((r) => !r.value.duplicate).length, 1);
    const [[{ n }]] = await db.pool.query('SELECT COUNT(*) AS n FROM occupancies WHERE source_event_id = ?', [eventId]);
    assert.equal(Number(n), 1);
  });

  after(async () => {
    await cleanup();
    await db.pool.end();
  });
})();
