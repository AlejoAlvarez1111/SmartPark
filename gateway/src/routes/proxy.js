const { callService, AppError } = require('@smartpark/shared');

/**
 * Reenvía /api/v1/<recurso>/... al servicio dueño del recurso, sin reglas de negocio.
 * Sin reintentos: un POST repetido podría duplicar efectos; los reintentos viven en los servicios.
 */
function createProxy({ services, timeoutMs }) {
  return async (req, res, next) => {
    const target = services[req.path.split('/')[1]];
    // Las rutas /internal/ son solo para comunicación entre servicios
    if (!target || req.path.includes('/internal/')) return next();

    const { status, body } = await callService(target.url, req.originalUrl, {
      method: req.method,
      body: req.body,
      requestId: res.locals.requestId,
      timeoutMs,
      serviceName: target.name,
    });
    if (!body) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', `El servicio ${target.name} devolvió una respuesta inválida`);
    res.status(status).json(body);
  };
}

module.exports = { createProxy };
