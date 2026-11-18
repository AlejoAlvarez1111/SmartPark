const { callService } = require('@smartpark/shared');

/**
 * GET /api/v1/dashboard: agrega en una llamada lo que necesita el tablero (BFF).
 * Sin reglas de negocio: solo reúne respuestas. Si un servicio no responde, su parte llega en null
 * y se nombra en `unavailable`; nunca se inventan datos (§9.6).
 */
function createDashboard({ services, timeoutMs }) {
  const parts = {
    summary: ['spaces', '/api/v1/spaces/summary'],
    spaces: ['spaces', '/api/v1/spaces'],
    recentEvents: ['sensors', '/api/v1/sensors/events?limit=8'],
  };

  return async (req, res) => {
    const unavailable = new Set();
    const entries = await Promise.all(
      Object.entries(parts).map(async ([key, [svcKey, path]]) => {
        const svc = services[svcKey];
        try {
          const r = await callService(svc.url, path, { requestId: res.locals.requestId, timeoutMs, serviceName: svc.name });
          if (r.status === 200 && r.body?.success) return [key, r.body.data];
        } catch {
          // servicio caído: se informa abajo
        }
        unavailable.add(svc.name);
        return [key, null];
      }),
    );
    res.json({
      success: true,
      data: { ...Object.fromEntries(entries), unavailable: [...unavailable], generatedAt: new Date().toISOString() },
      requestId: res.locals.requestId,
    });
  };
}

module.exports = { createDashboard };
