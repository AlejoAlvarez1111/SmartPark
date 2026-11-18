/**
 * Entrega a spaces-service los eventos de reserva guardados en outbox_events (§6.4):
 * intento inmediato tras cada cambio + reintento periódico, con un máximo de intentos.
 * Estados: PENDIENTE -> ENTREGADO | FALLIDO (error permanente 4xx o intentos agotados).
 */
function createOutboxDispatcher({ db, repo, clients, maxAttempts, intervalMs, logger }) {
  async function deliverOne(event, requestId) {
    const { reservationId, snapshot } = event.payload;
    const attempts = event.attempts + 1;
    let status = 'ENTREGADO';
    let lastError = null;
    try {
      const r = await clients.pushReservation(reservationId, snapshot, requestId);
      if (r.status >= 300) {
        lastError = `HTTP ${r.status} ${r.body?.error?.code ?? ''}`.trim();
        // 4xx: el evento nunca será aceptado (p. ej. espacio inexistente); no tiene sentido reintentar
        status = r.status < 500 ? 'FALLIDO' : attempts >= maxAttempts ? 'FALLIDO' : 'PENDIENTE';
      }
    } catch (err) {
      lastError = err.message;
      status = attempts >= maxAttempts ? 'FALLIDO' : 'PENDIENTE';
    }
    await repo.markOutbox(db.pool, event.id, { status, attempts, lastError });
    if (status !== 'ENTREGADO') {
      logger[status === 'FALLIDO' ? 'error' : 'warn']('Evento de reserva no entregado a spaces-service', {
        requestId,
        outboxId: event.id,
        eventType: event.eventType,
        reservationId,
        attempts,
        status,
        error: lastError,
      });
    }
    return status;
  }

  // Intento inmediato de un evento recién creado; devuelve su estado final
  async function deliver(eventId, requestId) {
    const event = await repo.findOutbox(db.pool, eventId);
    return event.status === 'PENDIENTE' ? deliverOne(event, requestId) : event.status;
  }

  // Reintenta los pendientes en orden de creación
  async function flush() {
    for (const event of await repo.pendingOutbox(db.pool, 20)) await deliverOne(event);
  }

  let timer;
  return {
    deliver,
    flush,
    start() {
      timer = setInterval(() => flush().catch((err) => logger.warn('No se pudo procesar el outbox', { error: err.message })), intervalMs);
      timer.unref();
    },
    stop: () => clearInterval(timer),
  };
}

module.exports = { createOutboxDispatcher };
