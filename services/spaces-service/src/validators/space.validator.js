const { z } = require('zod');
const { STATUSES } = require('../services/space.status');

z.config(z.locales.es());

const SPACE_TYPES = ['ESTANDAR', 'ACCESIBLE', 'MOTO'];
const RESERVATION_STATUSES = ['CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'EXPIRADA'];

const upper = (v) => String(v).trim().toUpperCase();

// "a-01" -> "A-01"
const code = z
  .string()
  .transform((v) => upper(v).replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{1,4}-?[A-Z0-9]{1,5}$/, 'El código debe ser como A-01 (letras, números y un guion opcional)'));

const zone = z
  .string()
  .transform(upper)
  .pipe(z.string().regex(/^[A-Z0-9 _-]{1,20}$/, 'La zona debe tener entre 1 y 20 letras o números'));

const eventId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,64}$/, 'eventId debe tener entre 1 y 64 caracteres alfanuméricos');

const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

const createSpaceSchema = z.strictObject({ code, zone, spaceType: z.enum(SPACE_TYPES) });

const updateSpaceSchema = z
  .strictObject({ code: code.optional(), zone: zone.optional(), spaceType: z.enum(SPACE_TYPES).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Debe enviar al menos un campo para actualizar');

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  type: z.enum(SPACE_TYPES).optional(),
  zone: zone.optional(),
});

const idParamSchema = z.object({ id: z.uuid('Identificador de espacio inválido') });
const occupySchema = z.strictObject({ vehicleId: z.uuid('vehicleId inválido'), eventId });
const releaseSchema = z.strictObject({ eventId });
const maintenanceSchema = z.strictObject({ outOfService: z.boolean() });

const eligibilityQuerySchema = z
  .object({ startAt: isoDate, endAt: isoDate })
  .refine((v) => v.startAt < v.endAt, { message: 'startAt debe ser anterior a endAt', path: ['endAt'] });

// Copia de una reserva enviada por reservations-service
const reservationParamSchema = z.object({ reservationId: z.uuid('Identificador de reserva inválido') });
const reservationSnapshotSchema = z.object({
  spaceId: z.uuid(),
  vehicleId: z.uuid(),
  startAt: isoDate,
  endAt: isoDate,
  status: z.enum(RESERVATION_STATUSES),
  updatedAt: isoDate,
});

module.exports = {
  SPACE_TYPES,
  createSpaceSchema,
  updateSpaceSchema,
  listQuerySchema,
  idParamSchema,
  occupySchema,
  releaseSchema,
  maintenanceSchema,
  eligibilityQuerySchema,
  reservationParamSchema,
  reservationSnapshotSchema,
};
