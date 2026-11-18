const { randomUUID } = require('node:crypto');
const { AppError } = require('./errors');

const ok = (res, data, message = 'Operación realizada correctamente', status = 200) =>
  res.status(status).json({ success: true, data, message, requestId: res.locals.requestId });

const fail = (res, status, code, message, details) =>
  res.status(status).json({
    success: false,
    error: details ? { code, message, details } : { code, message },
    requestId: res.locals.requestId,
  });

// Reutiliza el X-Request-ID entrante (lo pone el gateway) o crea uno nuevo
const requestId = (req, res, next) => {
  const incoming = req.get('x-request-id');
  res.locals.requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.set('X-Request-ID', res.locals.requestId);
  next();
};

const requestLogger = (logger) => (req, res, next) => {
  const start = Date.now();
  res.on('finish', () =>
    logger.info('request', {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
    }),
  );
  next();
};

const notFoundRoute = (req, res) => fail(res, 404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.originalUrl.split('?')[0]}`);

// Errores de conexión de mysql2: la BD es una dependencia caída, no un fallo interno
const DB_DOWN_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR']);

// Manejo centralizado: nunca envía stack traces al cliente, sí los registra en el log
const errorHandler = (logger) => (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(err.message, { requestId: res.locals.requestId, code: err.code });
    return fail(res, err.status, err.code, err.message, err.details);
  }
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'VALIDATION_ERROR', 'El cuerpo no es JSON válido');
  if (err.type === 'entity.too.large') return fail(res, 413, 'VALIDATION_ERROR', 'El cuerpo de la solicitud es demasiado grande');
  if (DB_DOWN_CODES.has(err.code)) {
    logger.error('Base de datos no disponible', { requestId: res.locals.requestId, path: req.originalUrl, error: err.code });
    return fail(res, 503, 'DEPENDENCY_UNAVAILABLE', 'La base de datos no está disponible');
  }
  logger.error('Error no controlado', {
    requestId: res.locals.requestId,
    path: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });
  return fail(res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
};

const startedAt = Date.now();

// GET /health: nombre, estado, versión y conexión a base de datos (§13.4). 503 si la BD no responde.
const healthHandler = ({ service, version, ping }) => async (req, res) => {
  const dbUp = await ping();
  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    data: {
      service,
      status: dbUp ? 'UP' : 'DEGRADED',
      version,
      database: dbUp ? 'UP' : 'DOWN',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    },
    requestId: res.locals.requestId,
  });
};

module.exports = { ok, fail, requestId, requestLogger, notFoundRoute, errorHandler, healthHandler };
