const { z } = require('zod');

z.config(z.locales.es());

const VEHICLE_TYPES = ['CARRO', 'MOTO', 'BICICLETA'];
const STATUSES = ['ACTIVO', 'INACTIVO'];

// "abc 123", " ABC-123 " -> "ABC123": mayúsculas, sin espacios ni guiones (§5.1)
const normalizePlate = (value) => String(value).trim().toUpperCase().replace(/[\s-]/g, '');

const plate = z
  .string()
  .transform(normalizePlate)
  .pipe(z.string().regex(/^[A-Z0-9]{4,8}$/, 'La placa debe tener entre 4 y 8 letras o números'));

// Texto opcional: "" o null se guardan como null
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const createVehicleSchema = z.strictObject({
  plate,
  vehicleType: z.enum(VEHICLE_TYPES),
  brand: optionalText(60),
  color: optionalText(30),
});

const updateVehicleSchema = z
  .strictObject({
    plate: plate.optional(),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    brand: optionalText(60).optional(),
    color: optionalText(30).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Debe enviar al menos un campo para actualizar');

const statusSchema = z.strictObject({ status: z.enum(STATUSES) });

const listQuerySchema = z.object({
  search: z
    .string()
    .transform(normalizePlate)
    .pipe(z.string().regex(/^[A-Z0-9]{0,8}$/, 'La búsqueda solo admite letras y números'))
    .optional(),
  status: z.enum(STATUSES).optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.uuid('Identificador de vehículo inválido') });
const plateParamSchema = z.object({ plate });

module.exports = {
  VEHICLE_TYPES,
  normalizePlate,
  createVehicleSchema,
  updateVehicleSchema,
  statusSchema,
  listQuerySchema,
  idParamSchema,
  plateParamSchema,
};
