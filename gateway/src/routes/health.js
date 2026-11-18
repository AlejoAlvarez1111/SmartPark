const { callService } = require('@smartpark/shared');

// GET /health: estado del gateway y de cada servicio, consultados en paralelo con timeout
function createHealth({ services, timeoutMs, version }) {
  return async (req, res) => {
    const entries = await Promise.all(
      Object.entries(services).map(async ([key, svc]) => {
        try {
          const { status, body } = await callService(svc.url, '/health', { requestId: res.locals.requestId, timeoutMs, serviceName: svc.name });
          const data = body?.data ?? {};
          return [key, { service: svc.name, status: status === 200 ? 'UP' : data.status || 'DEGRADED', database: data.database || 'DESCONOCIDO', version: data.version }];
        } catch {
          return [key, { service: svc.name, status: 'DOWN', database: 'DESCONOCIDO' }];
        }
      }),
    );
    const allUp = entries.every(([, s]) => s.status === 'UP');
    res.json({
      success: true,
      data: {
        service: 'gateway',
        status: allUp ? 'UP' : 'DEGRADED',
        version,
        services: Object.fromEntries(entries),
        timestamp: new Date().toISOString(),
      },
      requestId: res.locals.requestId,
    });
  };
}

module.exports = { createHealth };
