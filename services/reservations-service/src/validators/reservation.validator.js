const { z } = require('zod');

z.config(z.locales.es());

const STATUSES = ['CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'EXPIRADA'];
const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

const createReservationSchema = z
  .strictObject({
    vehicleId: z.uuid('vehicleId inválido'),
    spaceId: z.uuid('spaceId inválido'),
    startAt: isoDate,
    endAt: isoDate,
  })
  .refine((v) => v.startAt < v.endAt, { message: 'La hora de inicio debe ser anterior a la de fin', path: ['endAt'] });

// date=YYYY-MM-DD equivale al día UTC completo; para el día local el frontend envía from/to
const listQuerySchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    plate: z
      .string()
      .transform((v) => v.trim().toUpperCase().replace(/[\s-]/g, ''))
      .optional(),
    spaceId: z.uuid().optional(),
    vehicleId: z.uuid().optional(),
    date: z.iso.date().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((v) => !(v.date && (v.from || v.to)), 'Use date o from/to, no ambos')
  .transform(({ date, ...rest }) =>
    date ? { ...rest, from: new Date(`${date}T00:00:00Z`), to: new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000) } : rest,
  );

const idParamSchema = z.object({ id: z.uuid('Identificador de reserva inválido') });

module.exports = { STATUSES, createReservationSchema, listQuerySchema, idParamSchema };
