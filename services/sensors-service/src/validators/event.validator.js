const { z } = require('zod');

z.config(z.locales.es());

const EVENT_TYPES = ['VEHICLE_ENTERED', 'VEHICLE_EXITED', 'SENSOR_ERROR'];
const STATUSES = ['PENDIENTE', 'PROCESADO', 'RECHAZADO', 'FALLIDO'];

const base = {
  // Obligatorio y único (§10.3): lo genera el sensor, así un reenvío del mismo evento se reconoce
  eventId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,64}$/, 'eventId debe tener entre 1 y 64 caracteres alfanuméricos'),
  sensorId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, 'sensorId debe tener entre 1 y 40 letras, números, _ o -'),
  spaceId: z.uuid('spaceId inválido'),
  timestamp: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .optional(),
  source: z.enum(['MANUAL', 'AUTO']).default('MANUAL'),
};

const entrySchema = z.strictObject({ ...base, vehicleId: z.uuid('vehicleId inválido') });
const exitSchema = z.strictObject(base);

const listQuerySchema = z.object({
  type: z.enum(EVENT_TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  spaceId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

module.exports = { entrySchema, exitSchema, listQuerySchema };
