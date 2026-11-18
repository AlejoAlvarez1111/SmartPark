// Error de dominio con código HTTP y código estable (§12.1 de la especificación)
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const errors = {
  validation: (message = 'Datos de entrada inválidos', details) => new AppError(400, 'VALIDATION_ERROR', message, details),
  notFound: (code, message) => new AppError(404, code, message),
  conflict: (code, message) => new AppError(409, code, message),
  unavailable: (message = 'Servicio requerido no disponible') => new AppError(503, 'DEPENDENCY_UNAVAILABLE', message),
};

// Valida con un esquema zod (o cualquier objeto con safeParse) y lanza 400 con el detalle por campo
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw errors.validation(
    'Datos de entrada inválidos',
    result.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message })),
  );
}

module.exports = { AppError, errors, parse };
