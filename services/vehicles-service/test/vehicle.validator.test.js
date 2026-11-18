const { test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/validators/vehicle.validator');

test('normaliza placas: mayúsculas, sin espacios ni guiones', () => {
  assert.equal(v.normalizePlate('  abc 123 '), 'ABC123');
  assert.equal(v.normalizePlate('jkl-12d'), 'JKL12D');
});

test('acepta un vehículo válido y normaliza campos opcionales', () => {
  const r = v.createVehicleSchema.parse({ plate: 'abc123', vehicleType: 'CARRO', brand: ' Renault ', color: '' });
  assert.deepEqual(r, { plate: 'ABC123', vehicleType: 'CARRO', brand: 'Renault', color: null });
});

test('rechaza placas inválidas', () => {
  for (const plate of ['', 'AB1', 'ABC12345X', 'ABC#12', 'ÑAB123']) {
    assert.equal(v.createVehicleSchema.safeParse({ plate, vehicleType: 'CARRO' }).success, false, plate);
  }
});

test('rechaza tipo inválido y campos desconocidos', () => {
  assert.equal(v.createVehicleSchema.safeParse({ plate: 'ABC123', vehicleType: 'CAMION' }).success, false);
  assert.equal(v.createVehicleSchema.safeParse({ plate: 'ABC123', vehicleType: 'CARRO', admin: true }).success, false);
});

test('actualización exige al menos un campo', () => {
  assert.equal(v.updateVehicleSchema.safeParse({}).success, false);
  assert.equal(v.updateVehicleSchema.safeParse({ color: 'Azul' }).success, true);
});

test('query de listado: valores por defecto y límites', () => {
  assert.deepEqual(v.listQuerySchema.parse({}), { limit: 50, offset: 0 });
  assert.equal(v.listQuerySchema.parse({ search: 'abc 1' }).search, 'ABC1');
  assert.equal(v.listQuerySchema.safeParse({ limit: '500' }).success, false);
});
